// /api/archive/*: the archive's HTTP API (design: ideas/archive.md).
// Mounted by app.ts. Every route documents itself with docs() for the OpenAPI spec.

import { Hono } from "hono";
import { z } from "zod";
import {
  ArchiveRefSchema,
  ArchiveTypeInfoSchema,
  BlobSchema,
  CreateEntrySchema,
  EntryListSchema,
  EntrySchema,
  GcQuerySchema,
  GcResultSchema,
  ListQuerySchema,
  PatchEntrySchema,
  RecentSearchesSchema,
  RecordSearchSchema,
  ReferencedSchema,
  SearchKeySchema,
} from "../../shared/archive.ts";
import { ModuleIdSchema } from "../../shared/api.ts";
import { ArchiveTypeIdSchema, FileNameSchema, MAX_FILE_BYTES } from "../../shared/archive-types.ts";
import { docs, failure, json } from "../openapi.ts";
import type { AppEnv } from "../types.ts";
import { validate } from "../validate.ts";
import { sweep } from "./gc.ts";
import { createJobRoutes } from "./job-routes.ts";
import { contentDisposition, limitBytes, parseRange, servedContentType } from "./http.ts";
import { ArchiveError, type ArchiveDeps } from "./ports.ts";
import { inspectText } from "./text.ts";
import { archiveTypes } from "./types/index.ts";
import type { IngestContext } from "./types/define.ts";

const idParam = z.object({ id: z.uuid() });
const TAG = "archive";

// ETag comparison tolerant of weak validators (Caddy's compression makes them weak).
const etagMatches = (header: string | undefined, etag: string) =>
  header !== undefined && header.split(",").some((v) => v.trim().replace(/^W\//, "") === etag || v.trim() === "*");

export function createArchiveRoutes(deps: ArchiveDeps) {
  const { repo, blobs } = deps;
  return new Hono<AppEnv>()
    .get(
      "/types",
      docs(TAG, "List archive types", { 200: json("Registered types and the JSON Schema of each one's input", z.array(ArchiveTypeInfoSchema)) }),
      (c) =>
        c.json(
          Object.entries(archiveTypes).map(([id, t]) => ({
            id: ArchiveTypeIdSchema.parse(id),
            label: t.label,
            mode: t.mode,
            inputSchema: z.toJSONSchema(t.input),
          })),
        ),
    )

    .put(
      "/blobs",
      docs(
        TAG,
        "Upload one file's bytes",
        { 200: json("The content hash; use it to create an entry", BlobSchema), 413: failure(`Larger than ${String(MAX_FILE_BYTES)} bytes`) },
        "The raw request body is the file (curl --data-binary @file). Identical bytes are stored once. Unreferenced uploads are removed after 24 h.",
      ),
      async (c) => {
        if (Number(c.req.header("content-length") ?? 0) > MAX_FILE_BYTES) throw new ArchiveError("too_large", `a file may be at most ${String(MAX_FILE_BYTES)} bytes`);
        const blob = await blobs.put(limitBytes(c.req.raw.body ?? new Blob([]).stream(), MAX_FILE_BYTES));
        await repo.registerBlob(blob);
        c.var.log.info({ event: "blob.put", ...blob }, "blob stored");
        return c.json(blob);
      },
    )

    .post(
      "/entries",
      docs(
        TAG,
        "Create an entry",
        {
          201: json("The new entry", EntrySchema),
          400: failure("Invalid body, invalid `input` for the type (see GET /archive/types), or a type that is added through POST /archive/jobs"),
          422: failure("A named blob was not uploaded"),
          409: failure("Duplicate file name"),
        },
        "`input` depends on `type`; GET /archive/types lists each type's input JSON Schema.",
      ),
      validate("json", CreateEntrySchema),
      async (c) => {
        const body = c.req.valid("json");
        const handler = archiveTypes[body.type];
        if (handler.mode !== "entry") throw new ArchiveError("wrong_mode", `${body.type} entries are added in the background: use POST /archive/jobs`);
        const ctx: IngestContext = {
          putBlob: async (stream) => {
            const blob = await blobs.put(stream);
            await repo.registerBlob(blob);
            return blob;
          },
          hasBlob: async (sha256) => (await repo.existingBlobs([sha256])).has(sha256),
          discardBlob: async (sha256) => {
            if (await repo.deleteBlobIfUnreferenced(sha256)) await blobs.delete(sha256);
          },
          readText: async (sha256, headChars) => {
            const stream = await blobs.get(sha256);
            return stream ? inspectText(stream, headChars) : null;
          },
          log: c.var.log,
        };
        const result = await handler.ingest(body.input, ctx);
        const entry = await repo.createEntry({
          type: body.type,
          title: body.title ?? result.title,
          sourceUrl: result.sourceUrl,
          meta: result.meta,
          searchText: result.searchText,
          tags: body.tags,
          files: result.files,
        });
        c.var.log.info({ event: "entry.created", id: entry.id, type: entry.type }, "entry created");
        return c.json(entry, 201);
      },
    )

    .get(
      "/entries",
      docs(TAG, "Search or list entries", { 200: json("Newest first; omit q for recent additions", EntryListSchema) }, "Pass `cursor` = the previous page's nextCursor for the next page."),
      validate("query", ListQuerySchema),
      async (c) => c.json(await repo.listEntries(c.req.valid("query"))),
    )

    .get(
      "/entries/:id",
      docs(TAG, "Get an entry", { 200: json("Entry with files, tags and refs", EntrySchema), 404: failure("No such entry") }),
      validate("param", idParam),
      async (c) => {
        const entry = await repo.getEntry(c.req.valid("param").id);
        return entry ? c.json(entry) : c.json({ error: "entry not found" }, 404);
      },
    )

    .patch(
      "/entries/:id",
      docs(TAG, "Change an entry's title or tags", { 200: json("The updated entry", EntrySchema), 404: failure("No such entry") }),
      validate("param", idParam),
      validate("json", PatchEntrySchema),
      async (c) => {
        const entry = await repo.updateEntry(c.req.valid("param").id, c.req.valid("json"));
        return entry ? c.json(entry) : c.json({ error: "entry not found" }, 404);
      },
    )

    .delete(
      "/entries/:id",
      docs(TAG, "Delete an entry", {
        204: { description: "Deleted" },
        404: failure("No such entry"),
        409: json("Still referenced by other modules; release the refs first", ReferencedSchema),
      }),
      validate("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        const freed = await repo.deleteEntry(id);
        for (const sha256 of freed) {
          // The entry is gone either way; a file that can't be removed is picked up by the gc (strays).
          await blobs.delete(sha256).catch((err: unknown) => {
            c.var.log.error({ err, sha256 }, "could not remove blob");
          });
        }
        c.var.log.info({ event: "entry.deleted", id, blobs: freed.length }, "entry deleted");
        return c.body(null, 204);
      },
    )

    .get(
      "/entries/:id/files/:name{.+}",
      docs(
        TAG,
        "Download a file of an entry",
        { 200: { description: "The file's bytes" }, 206: { description: "Partial content (Range)" }, 404: failure("No such file") },
        "Sent with the file's mime type when it is one that browsers only play or parse (video, images, subtitles, JSON); anything else as text/plain. Supports Range and ETag (the blob's sha256).",
      ),
      validate("param", z.object({ id: z.uuid(), name: FileNameSchema })),
      async (c) => {
        const { id, name } = c.req.valid("param");
        const file = await repo.getFile(id, name);
        if (!file) return c.json({ error: "file not found" }, 404);

        const etag = `"${file.sha256}"`;
        const headers = new Headers({
          etag,
          "accept-ranges": "bytes",
          "content-type": servedContentType(file.mime),
          "content-disposition": contentDisposition(name),
          "cache-control": "private, no-cache",
          "x-content-type-options": "nosniff",
        });
        if (etagMatches(c.req.header("if-none-match"), etag)) return new Response(null, { status: 304, headers });

        const range = parseRange(c.req.header("range"), file.size);
        if (range === "unsatisfiable") {
          headers.set("content-range", `bytes */${String(file.size)}`);
          return new Response(null, { status: 416, headers });
        }
        const body = await blobs.get(file.sha256, range ?? undefined);
        if (!body) {
          c.var.log.error({ event: "blob.missing", sha256: file.sha256, entry: id, name }, "blob missing on disk");
          return c.json({ error: "file content is missing" }, 500);
        }
        if (range) {
          headers.set("content-range", `bytes ${String(range.start)}-${String(range.end)}/${String(file.size)}`);
          headers.set("content-length", String(range.end - range.start + 1));
        } else {
          headers.set("content-length", String(file.size));
        }
        return new Response(body, { status: range ? 206 : 200, headers });
      },
    )

    .put(
      "/entries/:id/refs/:module/:itemId",
      docs(TAG, "Register that a module item uses an entry", { 200: json("The ref (idempotent)", ArchiveRefSchema), 404: failure("No such entry") }, "An entry with refs cannot be deleted."),
      validate("param", z.object({ id: z.uuid(), module: ModuleIdSchema, itemId: z.string().min(1).max(200) })),
      async (c) => {
        const { id, module, itemId } = c.req.valid("param");
        return c.json(await repo.putRef(id, module, itemId));
      },
    )

    .delete(
      "/entries/:id/refs/:module/:itemId",
      docs(TAG, "Release a ref", { 204: { description: "Released" }, 404: failure("No such ref") }),
      validate("param", z.object({ id: z.uuid(), module: ModuleIdSchema, itemId: z.string().min(1).max(200) })),
      async (c) => {
        const { id, module, itemId } = c.req.valid("param");
        return (await repo.deleteRef(id, module, itemId)) ? c.body(null, 204) : c.json({ error: "ref not found" }, 404);
      },
    )

    .get(
      "/searches",
      docs(TAG, "Recent searches", { 200: json("Most recent distinct searches", RecentSearchesSchema) }),
      async (c) => c.json(await repo.recentSearches(10)),
    )

    .post(
      "/searches",
      docs(TAG, "Record a search", { 204: { description: "Recorded" } }, "The UI records a search when it is submitted, not on every keystroke."),
      validate("json", RecordSearchSchema),
      async (c) => {
        await repo.recordSearch(c.req.valid("json"));
        return c.body(null, 204);
      },
    )

    .delete(
      "/searches",
      docs(TAG, "Remove a recent search", { 204: { description: "Removed (also when there was nothing to remove)" } }, "Identified like the list shows it: `query` and, if it was filtered, `type`."),
      validate("query", SearchKeySchema),
      async (c) => {
        await repo.deleteSearch(c.req.valid("query"));
        return c.body(null, 204);
      },
    )

    .post(
      "/gc",
      docs(
        TAG,
        "Run the garbage sweep now",
        { 200: json("What was removed", GcResultSchema) },
        "Removes unreferenced blobs older than `graceHours` (default 24; also runs hourly in the app). Deleting an entry already frees its blobs, so this mostly collects abandoned uploads. With 0, an upload that has not been attached to an entry yet is removed too: only use it when nothing is being added.",
      ),
      validate("query", GcQuerySchema),
      async (c) => c.json(await sweep({ ...deps, log: c.var.log }, c.req.valid("query").graceHours * 3_600_000)),
    )

    .route("/jobs", createJobRoutes(deps));
}

