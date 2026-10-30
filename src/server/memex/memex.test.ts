// Integration tests: the real app + drizzle repo on memex_test, with a temp asset store.

import { describe, expect, it } from "vitest";
import { emptyPageDoc, type PageDoc, type PageElement } from "../../shared/memex-doc.ts";
import { AssetSchema, MemexPageListSchema, MemexPageSchema, SavedSchema, TagCountsSchema, VersionConflictSchema, type MemexPage } from "../../shared/memex.ts";
import { silentLogger, useHarness } from "../testing/harness.ts";
import { sweepMemex } from "./gc.ts";

const h = useHarness();
const M = "/api/memex";

// A 1x1 transparent PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

const base = { rotation: 0, opacity: 1, hidden: false, locked: false, effects: [] };
const textBox = (id: string, text: string): PageElement => ({
  ...base,
  id,
  kind: "text",
  font: "sans",
  x: 36,
  y: 36,
  w: 200,
  h: 40,
  fontSize: 12,
  lineHeight: 1.2,
  align: "left",
  color: "#000000",
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
});
const image = (id: string, asset: string): PageElement => ({ ...base, id, kind: "image", x: 0, y: 0, w: 72, h: 72, asset, fit: "contain" });
const withElements = (...elements: PageElement[]): PageDoc => ({ ...emptyPageDoc(), elements });

async function createPage(body: Record<string, unknown> = {}): Promise<MemexPage> {
  const res = await h.send(`${M}/pages`, body);
  expect(res.status).toBe(201);
  return MemexPageSchema.parse(await res.json());
}

const save = (page: { id: string; version: number }, title: string, doc: unknown) => h.send(`${M}/pages/${page.id}`, { title, doc, baseVersion: page.version }, "PUT");
const getPage = async (id: string) => MemexPageSchema.parse(await (await h.request(`${M}/pages/${id}`)).json());
const titles = async (query: string) => MemexPageListSchema.parse(await (await h.request(`${M}/pages${query}`)).json()).items.map((p) => p.title);

async function upload(body: string | Uint8Array<ArrayBuffer>) {
  return h.request(`${M}/assets`, { method: "PUT", body, headers: { "content-type": "image/png" } });
}
async function uploadOk(body: string | Uint8Array<ArrayBuffer>) {
  const res = await upload(body);
  expect(res.status).toBe(200);
  return AssetSchema.parse(await res.json());
}

describe("memex pages", () => {
  it("creates an Untitled Half Letter page by default", async () => {
    const page = await createPage();
    expect(page).toMatchObject({ title: "Untitled", tags: [], version: 1 });
    expect(page.doc.format).toEqual({ size: "half", orientation: "portrait", margin: 36 });
    expect(page.doc.elements).toEqual([]);
  });

  it("saves with a version check and refuses an invalid doc", async () => {
    const page = await createPage({ title: "Zine" });
    const res = await save(page, "Zine one", withElements(textBox("a", "hello")));
    expect(SavedSchema.parse(await res.json()).version).toBe(2);

    const stale = await save(page, "x", withElements());
    expect(stale.status).toBe(409);
    expect(VersionConflictSchema.parse(await stale.json()).version).toBe(2);

    expect((await save({ id: page.id, version: 2 }, "x", { ...withElements(), format: { size: "a4", orientation: "portrait", margin: 36 } })).status).toBe(400);
    const dup = withElements(textBox("same", "a"), textBox("same", "b"));
    expect((await save({ id: page.id, version: 2 }, "x", dup)).status).toBe(400);

    const got = await getPage(page.id);
    expect(got).toMatchObject({ title: "Zine one", version: 2 });
    expect(got.doc.elements).toHaveLength(1);
    expect((await h.request(`${M}/pages/019a0000-0000-7000-8000-00000000ffff`)).status).toBe(404);
  });

  it("searches the text boxes and #tags, and lists the format", async () => {
    const a = await createPage({ title: "Recipes", tags: ["Food"] });
    await save(a, "Recipes", withElements(textBox("t", "sourdough starter")));
    await createPage({ title: "Garden", tags: ["home"], doc: { ...emptyPageDoc({ size: "quarter", orientation: "landscape", margin: 18 }), elements: [] } });

    expect(await titles("?q=sourd")).toEqual(["Recipes"]);
    expect(await titles("?q=%23food")).toEqual(["Recipes"]);
    expect(await titles("?q=sourdough%20%23home")).toEqual([]);
    const list = MemexPageListSchema.parse(await (await h.request(`${M}/pages`)).json());
    expect(list.items.map((p) => [p.title, p.format.size, p.snippet])).toEqual([
      ["Garden", "quarter", ""],
      ["Recipes", "half", "sourdough starter"],
    ]);

    const tagged = MemexPageSchema.parse(await (await h.send(`${M}/pages/${a.id}`, { tags: ["food", "Bread"] }, "PATCH")).json());
    expect(tagged.tags).toEqual(["bread", "food"]);
    expect(TagCountsSchema.parse(await (await h.request(`${M}/tags`)).json()).items).toEqual([
      { tag: "bread", count: 1 },
      { tag: "food", count: 1 },
      { tag: "home", count: 1 },
    ]);
    expect((await h.request(`${M}/pages/${a.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await titles("")).toEqual(["Garden"]);
  });
});

describe("memex assets", () => {
  it("stores images and SVGs with the type found in the bytes, and serves them safely", async () => {
    const png = await uploadOk(PNG);
    expect(png.mime).toBe("image/png");
    const res = await h.request(`${M}/assets/${png.sha256}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect((await h.request(`${M}/assets/${png.sha256}`, { headers: { "if-none-match": `W/"${png.sha256}"` } })).status).toBe(304);

    const svg = await uploadOk(SVG);
    expect(svg.mime).toBe("image/svg+xml");
    const served = await h.request(`${M}/assets/${svg.sha256}`);
    expect(served.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(served.headers.get("content-security-policy")).toContain("sandbox");

    const scene = await uploadOk(JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));
    expect(scene.mime).toBe("application/json");
  });

  it("refuses other bytes and deletes them at once", async () => {
    for (const body of ["just text", "<html><body>hi</body></html>", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '{"type":"other"}']) {
      const res = await upload(body);
      expect(res.status, body).toBe(400);
    }
    const stored: string[] = [];
    for await (const f of h.memex.blobs.list()) stored.push(f.sha256);
    expect(stored).toEqual([]);
    expect((await h.request(`${M}/assets/${"0".repeat(64)}`)).status).toBe(404);
  });

  it("detaches assets no page uses, re-attaches them, and sweeps them after the grace period", async () => {
    const used = await uploadOk(PNG);
    const unused = await uploadOk(SVG);
    const page = await createPage({ doc: withElements(image("i", used.sha256)) });

    // Fresh uploads keep their day; with no grace, only what no page uses goes.
    const swept = await sweepMemex({ ...h.memex, log: silentLogger }, 0);
    expect(swept.assets).toBe(1);
    expect((await h.request(`${M}/assets/${unused.sha256}`)).status).toBe(404);
    expect((await h.request(`${M}/assets/${used.sha256}`)).status).toBe(200);

    // Removed from the page: detached, but saving it back (undo) re-attaches it.
    const v2 = SavedSchema.parse(await (await save(page, "p", withElements())).json());
    const v3 = SavedSchema.parse(await (await save({ id: page.id, version: v2.version }, "p", withElements(image("i", used.sha256)))).json());
    expect((await sweepMemex({ ...h.memex, log: silentLogger }, 0)).assets).toBe(0);

    // Deleting the page detaches it; the sweep then removes row and bytes.
    expect(v3.version).toBe(3);
    await h.request(`${M}/pages/${page.id}`, { method: "DELETE" });
    expect((await sweepMemex({ ...h.memex, log: silentLogger }, 0)).assets).toBe(1);
    expect((await h.request(`${M}/assets/${used.sha256}`)).status).toBe(404);
  });
});
