// /api/memex/*: the memex HTTP API (design: ideas/printable.md). Mounted by app.ts.
// Every route documents itself with docs() for the OpenAPI spec.

import { Hono } from "hono";
import { z } from "zod";
import { emptyPageDoc, Sha256Schema } from "../../shared/memex-doc.ts";
import {
  AssetSchema,
  CreateMemexPageSchema,
  MAX_ASSET_BYTES,
  MAX_TEXT_ASSET_BYTES,
  MemexPageListQuerySchema,
  MemexPageListSchema,
  MemexPageSchema,
  PatchMemexPageSchema,
  SavedSchema,
  SaveMemexPageSchema,
  TagCountsSchema,
  VersionConflictSchema,
  type AssetMime,
} from "../../shared/memex.ts";
import { limitBytes } from "../archive/http.ts";
import type { ByteStream } from "../archive/ports.ts";
import { docs, failure, json } from "../openapi.ts";
import type { AppEnv } from "../types.ts";
import { validate } from "../validate.ts";
import { MemexError, type MemexDeps } from "./ports.ts";
import { checkText, maybeText, rasterMime } from "./sniff.ts";

const idParam = z.object({ id: z.uuid() });
const TAG = "memex";
const HEAD_BYTES = 64;

const bytesOf = async (stream: ByteStream) => new Uint8Array(await new Response(stream).arrayBuffer());

// Every asset is sent with a sandboxing CSP, so even opened on its own it runs nothing. An SVG is
// also a download when opened directly: the app shows it only through <img>, where scripts never
// run (ideas/printable.md, "SVG served from the app origin").
function assetHeaders(sha256: string, mime: AssetMime, size: number): Headers {
  const svg = mime === "image/svg+xml";
  return new Headers({
    etag: `"${sha256}"`,
    "content-type": mime === "application/json" ? "application/json; charset=utf-8" : mime,
    "content-length": String(size),
    "content-disposition": `${svg ? "attachment" : "inline"}; filename="${sha256.slice(0, 16)}${svg ? ".svg" : ""}"`,
    "content-security-policy": svg ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox" : "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    // Content-addressed: the bytes behind a hash never change.
    "cache-control": "private, max-age=31536000, immutable",
  });
}

export function createMemexRoutes({ repo, blobs }: MemexDeps) {
  // The type of stored bytes, or why they are refused.
  async function identify(sha256: string, size: number): Promise<{ mime: AssetMime } | { error: string }> {
    const head = await blobs.get(sha256, { start: 0, end: Math.max(0, Math.min(size, HEAD_BYTES) - 1) });
    const first = head ? await bytesOf(head) : new Uint8Array();
    const raster = rasterMime(first);
    if (raster) return { mime: raster };
    if (!maybeText(first)) return { error: "not a PNG, JPEG, GIF, WebP, AVIF or SVG image" };
    if (size > MAX_TEXT_ASSET_BYTES) return { error: `SVG and scene files may be at most ${String(MAX_TEXT_ASSET_BYTES)} bytes` };
    const whole = await blobs.get(sha256);
    return checkText(whole ? await bytesOf(whole) : new Uint8Array());
  }

  return new Hono<AppEnv>()
    .get(
      "/pages",
      docs(TAG, "List or search memex pages", { 200: json("Pages, most recently edited first", MemexPageListSchema) }),
      validate("query", MemexPageListQuerySchema),
      async (c) => c.json(await repo.listPages(c.req.valid("query"))),
    )

    .post(
      "/pages",
      docs(TAG, "Create a memex page", { 201: json("The page", MemexPageSchema) }, "Everything is optional: a new page is titled Untitled and starts as an empty Half Letter page with a 0.5 in margin."),
      validate("json", CreateMemexPageSchema),
      async (c) => {
        const input = c.req.valid("json");
        const page = await repo.createPage({ title: input.title ?? "", tags: input.tags ?? [], doc: input.doc ?? emptyPageDoc() });
        c.var.log.info({ event: "memex.page.created", id: page.id }, "page created");
        return c.json(page, 201);
      },
    )

    .get(
      "/pages/:id",
      docs(TAG, "Get a memex page", { 200: json("The page with its doc (format, grid, elements in z-order)", MemexPageSchema), 404: failure("No such page") }),
      validate("param", idParam),
      async (c) => {
        const page = await repo.getPage(c.req.valid("param").id);
        return page ? c.json(page) : c.json({ error: "page not found" }, 404);
      },
    )

    .put(
      "/pages/:id",
      docs(
        TAG,
        "Save a memex page's title and doc",
        { 200: json("The new version", SavedSchema), 404: failure("No such page"), 409: json("Saved elsewhere since baseVersion; `version` is the current one", VersionConflictSchema) },
        "The editor saves a moment after the last change. The assets the page uses are rebuilt from the doc; an asset hash that was never uploaded is kept in the doc but shows as missing.",
      ),
      validate("param", idParam),
      validate("json", SaveMemexPageSchema),
      async (c) => c.json(await repo.savePage(c.req.valid("param").id, c.req.valid("json"))),
    )

    .patch(
      "/pages/:id",
      docs(TAG, "Set a memex page's tags", { 200: json("The page", MemexPageSchema), 404: failure("No such page") }, "Tags are not versioned: this doesn't conflict with a save."),
      validate("param", idParam),
      validate("json", PatchMemexPageSchema),
      async (c) => {
        const page = await repo.setTags(c.req.valid("param").id, c.req.valid("json").tags);
        return page ? c.json(page) : c.json({ error: "page not found" }, 404);
      },
    )

    .delete(
      "/pages/:id",
      docs(TAG, "Delete a memex page", { 204: { description: "Deleted" }, 404: failure("No such page") }, "Assets no other page uses are deleted a day later."),
      validate("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        if (!(await repo.deletePage(id))) return c.json({ error: "page not found" }, 404);
        c.var.log.info({ event: "memex.page.deleted", id }, "page deleted");
        return c.body(null, 204);
      },
    )

    .get(
      "/tags",
      docs(TAG, "Memex tags in use", { 200: json("Every tag on a memex page, with how many pages have it", TagCountsSchema) }),
      async (c) => c.json({ items: await repo.tagCounts() }),
    )

    .put(
      "/assets",
      docs(
        TAG,
        "Upload an asset",
        {
          200: json("The asset: its hash (use it in an element) and the type the server found", AssetSchema),
          400: failure("Not a PNG, JPEG, GIF, WebP, AVIF, SVG or Excalidraw scene, or an SVG holding scripts or external references"),
          413: failure(`Larger than ${String(MAX_ASSET_BYTES)} bytes`),
        },
        "The raw request body is the file (curl --data-binary @file); its Content-Type is ignored. Identical bytes are stored once. An asset no page uses is deleted after a day.",
      ),
      async (c) => {
        if (Number(c.req.header("content-length") ?? 0) > MAX_ASSET_BYTES) throw new MemexError("too_large", `an asset may be at most ${String(MAX_ASSET_BYTES)} bytes`);
        const blob = await blobs.put(limitBytes(c.req.raw.body ?? new Blob([]).stream(), MAX_ASSET_BYTES));
        const found = await identify(blob.sha256, blob.size);
        if ("error" in found) {
          // Refused bytes go at once, unless they are a known asset (then they passed before).
          if (!(await repo.existingAssets([blob.sha256])).has(blob.sha256)) await blobs.delete(blob.sha256);
          throw new MemexError("invalid", `refused: ${found.error}`);
        }
        const asset = await repo.registerAsset({ sha256: blob.sha256, mime: found.mime, size: blob.size });
        c.var.log.info({ event: "memex.asset.put", ...asset }, "asset stored");
        return c.json(asset);
      },
    )

    .get(
      "/assets/:sha256",
      docs(
        TAG,
        "Download an asset",
        { 200: { description: "The asset's bytes, as the type the server found when it was uploaded" }, 304: { description: "Not modified (ETag)" }, 404: failure("No such asset") },
        "Immutable and cacheable. Sent with a sandboxing Content-Security-Policy and nosniff; an SVG is sent as an attachment, so it only renders inside <img>.",
      ),
      validate("param", z.object({ sha256: Sha256Schema })),
      async (c) => {
        const { sha256 } = c.req.valid("param");
        const asset = await repo.getAsset(sha256);
        if (!asset) return c.json({ error: "asset not found" }, 404);
        const headers = assetHeaders(sha256, asset.mime, asset.size);
        const inm = c.req.header("if-none-match");
        if (inm && inm.split(",").some((v) => v.trim().replace(/^W\//, "") === `"${sha256}"`)) return new Response(null, { status: 304, headers });
        const body = await blobs.get(sha256);
        if (!body) {
          c.var.log.error({ event: "memex.asset.missing", sha256 }, "asset missing on disk");
          return c.json({ error: "asset content is missing" }, 500);
        }
        return new Response(body, { status: 200, headers });
      },
    );
}
