// Integration tests: the real app + drizzle repo on memex_test.

import { describe, expect, it } from "vitest";
import { EntrySchema, ReferencedSchema } from "../../shared/archive.ts";
import type { Doc, DocNode } from "../../shared/notes-doc.ts";
import {
  BacklinksSchema,
  BlockHitsSchema,
  DrawingSchema,
  PageListSchema,
  PageSchema,
  SavedSchema,
  TagCountsSchema,
  VersionConflictSchema,
  type Page,
} from "../../shared/notes.ts";
import { useHarness } from "../testing/harness.ts";
import { silentLogger } from "../testing/harness.ts";
import { sweepNotes } from "./gc.ts";

const h = useHarness();
const N = "/api/notes";

const text = (t: string): DocNode => ({ type: "text", text: t });
const para = (id: string, ...content: DocNode[]): DocNode => ({ type: "paragraph", attrs: { id }, content });
const doc = (...content: DocNode[]): Doc => ({ type: "doc", content });

async function createPage(body: Record<string, unknown> = {}): Promise<Page> {
  const res = await h.send(`${N}/pages`, body);
  expect(res.status).toBe(201);
  return PageSchema.parse(await res.json());
}

async function save(page: { id: string; version: number }, title: string, d: Doc) {
  return h.send(`${N}/pages/${page.id}`, { title, doc: d, baseVersion: page.version }, "PUT");
}

async function getPage(id: string): Promise<Page> {
  return PageSchema.parse(await (await h.request(`${N}/pages/${id}`)).json());
}

const titles = async (query: string) =>
  PageListSchema.parse(await (await h.request(`${N}/pages${query}`)).json()).items.map((p) => p.title);

describe("pages", () => {
  it("creates an Untitled empty page by default", async () => {
    const page = await createPage();
    expect(page).toMatchObject({ title: "Untitled", tags: [], version: 1, linkTitles: {} });
    expect(page.doc.type).toBe("doc");
  });

  it("saves with a version check", async () => {
    const page = await createPage({ title: "Draft" });
    const res = await save(page, "Plan", doc(para("a", text("hello world"))));
    expect(res.status).toBe(200);
    const saved = SavedSchema.parse(await res.json());
    expect(saved.version).toBe(2);

    const stale = await save(page, "Other", doc());
    expect(stale.status).toBe(409);
    expect(VersionConflictSchema.parse(await stale.json()).version).toBe(2);

    const got = await getPage(page.id);
    expect(got).toMatchObject({ title: "Plan", version: 2 });
    expect(got.doc.content?.[0]?.content?.[0]?.text).toBe("hello world");
  });

  it("answers 404 for a missing page, 400 for a bad doc", async () => {
    const missing = "019a0000-0000-7000-8000-00000000ffff";
    expect((await h.request(`${N}/pages/${missing}`)).status).toBe(404);
    expect((await save({ id: missing, version: 1 }, "x", doc())).status).toBe(404);
    const page = await createPage();
    expect((await h.send(`${N}/pages/${page.id}`, { title: "x", doc: { type: "paragraph" }, baseVersion: 1 }, "PUT")).status).toBe(400);
  });

  it("lists most recently edited first, searches words and #tags, and pages with a cursor", async () => {
    const a = await createPage({ title: "Alpha notes", tags: ["Work"] });
    await createPage({ title: "Beta", tags: ["home"] });
    const c = await createPage({ title: "Gamma" });
    await save(c, "Gamma", doc(para("x", text("alphabet soup"))));
    expect(await titles("")).toEqual(["Gamma", "Beta", "Alpha notes"]);
    expect(await titles("?q=alpha")).toEqual(["Gamma", "Alpha notes"]);
    expect(await titles("?q=alpha%20%23work")).toEqual(["Alpha notes"]);
    expect(await titles("?tag=home")).toEqual(["Beta"]);

    const first = PageListSchema.parse(await (await h.request(`${N}/pages?limit=2`)).json());
    expect(first.items.map((p) => p.title)).toEqual(["Gamma", "Beta"]);
    expect(first.nextCursor).not.toBeNull();
    const rest = PageListSchema.parse(await (await h.request(`${N}/pages?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`)).json());
    expect(rest).toEqual({ items: [expect.objectContaining({ id: a.id })], nextCursor: null });
  });

  it("sets tags without touching the version, and counts them", async () => {
    const page = await createPage({ tags: ["a"] });
    await createPage({ tags: ["a", "b"] });
    const res = await h.send(`${N}/pages/${page.id}`, { tags: ["Z", "a", "a"] }, "PATCH");
    expect(PageSchema.parse(await res.json())).toMatchObject({ tags: ["a", "z"], version: 1 });
    expect(TagCountsSchema.parse(await (await h.request(`${N}/tags`)).json()).items).toEqual([
      { tag: "a", count: 2 },
      { tag: "b", count: 1 },
      { tag: "z", count: 1 },
    ]);
  });
});

describe("links between pages", () => {
  it("indexes blocks, resolves link titles and lists backlinks", async () => {
    const target = await createPage({ title: "Target" });
    await save(target, "Target", doc(para("t1", text("the important block"))));
    const source = await createPage({ title: "Source" });
    await save(
      source,
      "Source",
      doc(para("s1", text("see "), { type: "blockLink", attrs: { pageId: target.id, blockId: "t1" } }), para("s2", { type: "pageLink", attrs: { pageId: target.id } })),
    );

    expect((await getPage(source.id)).linkTitles).toEqual({ [target.id]: "Target" });
    const backlinks = BacklinksSchema.parse(await (await h.request(`${N}/pages/${target.id}/backlinks`)).json()).items;
    expect(backlinks).toEqual([
      { pageId: source.id, pageTitle: "Source", blockId: "s1", text: "see ", targetBlockId: "t1" },
      { pageId: source.id, pageTitle: "Source", blockId: "s2", text: "", targetBlockId: null },
    ]);

    const hits = BlockHitsSchema.parse(await (await h.request(`${N}/blocks?q=important`)).json()).items;
    expect(hits).toEqual([{ pageId: target.id, pageTitle: "Target", blockId: "t1", type: "paragraph", text: "the important block" }]);
    // % is a literal character, not a wildcard
    expect(BlockHitsSchema.parse(await (await h.request(`${N}/blocks?q=%25`)).json()).items).toEqual([]);
  });

  it("keeps links to a deleted page, which then has no title", async () => {
    const target = await createPage({ title: "Gone soon" });
    const source = await createPage();
    await save(source, "Source", doc(para("s", { type: "pageLink", attrs: { pageId: target.id } })));
    expect((await h.request(`${N}/pages/${target.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await getPage(source.id)).linkTitles).toEqual({});
  });
});

describe("archive refs", () => {
  async function textEntry() {
    const res = await h.send("/api/archive/entries", { type: "text", input: { text: "# Embedded\nbody" } });
    return EntrySchema.parse(await res.json());
  }

  it("registers embedded entries as refs, so they can't be deleted, and releases them", async () => {
    const entry = await textEntry();
    const page = await createPage();
    await save(page, "Uses it", doc({ type: "archiveEmbed", attrs: { id: "e", entryId: entry.id } }));

    const refused = await h.request(`/api/archive/entries/${entry.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(ReferencedSchema.parse(await refused.json()).refs).toEqual([expect.objectContaining({ module: "notes", itemId: page.id })]);

    await save({ id: page.id, version: 2 }, "No longer", doc(para("p", text("nothing"))));
    expect((await h.request(`/api/archive/entries/${entry.id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("finds a page and its embed block by a bookmark label", async () => {
    const entry = await textEntry();
    const page = await createPage({ title: "Watching" });
    const bookmarks = [{ t: 75, label: "the zebra moment" }];
    await save(page, "Watching", doc({ type: "archiveEmbed", attrs: { id: "v", entryId: entry.id, bookmarks } }));
    expect(await titles("?q=zebra")).toEqual(["Watching"]);
    const hits = BlockHitsSchema.parse(await (await h.request(`${N}/blocks?q=zebra`)).json()).items;
    expect(hits).toEqual([{ pageId: page.id, pageTitle: "Watching", blockId: "v", type: "archiveEmbed", text: "the zebra moment" }]);
  });

  it("releases refs when the page is deleted, and skips entries that don't exist", async () => {
    const entry = await textEntry();
    const page = await createPage({ doc: doc({ type: "archiveLink", attrs: { entryId: entry.id, label: "x" } }, { type: "archiveEmbed", attrs: { entryId: "019a0000-0000-7000-8000-00000000dead" } }) });
    expect(EntrySchema.parse(await (await h.request(`/api/archive/entries/${entry.id}`)).json()).refs).toHaveLength(1);
    await h.request(`${N}/pages/${page.id}`, { method: "DELETE" });
    expect((await h.request(`/api/archive/entries/${entry.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("drawings", () => {
  const scene = { elements: [{ id: "r1", type: "rectangle", version: 3 }], appState: { viewBackgroundColor: "#fff" } };

  it("saves a scene with a version check", async () => {
    const drawing = DrawingSchema.parse(await (await h.send(`${N}/drawings`, {})).json());
    expect(drawing).toMatchObject({ version: 1, scene: { elements: [] } });
    const res = await h.send(`${N}/drawings/${drawing.id}`, { scene, baseVersion: 1 }, "PUT");
    expect(SavedSchema.parse(await res.json()).version).toBe(2);
    expect((await h.send(`${N}/drawings/${drawing.id}`, { scene, baseVersion: 1 }, "PUT")).status).toBe(409);
    expect(DrawingSchema.parse(await (await h.request(`${N}/drawings/${drawing.id}`)).json()).scene).toEqual(scene);
  });

  it("sweeps drawings no page shows, after the grace period", async () => {
    const shown = DrawingSchema.parse(await (await h.send(`${N}/drawings`, {})).json());
    const dropped = DrawingSchema.parse(await (await h.send(`${N}/drawings`, {})).json());
    const page = await createPage({ doc: doc({ type: "drawing", attrs: { id: "a", drawingId: shown.id } }, { type: "drawing", attrs: { id: "b", drawingId: dropped.id } }) });
    await save(page, "One left", doc({ type: "drawing", attrs: { id: "a", drawingId: shown.id } }));

    const deps = { ...h.notes, log: silentLogger };
    expect(await sweepNotes(deps)).toBe(0); // still within the day
    expect(await sweepNotes(deps, 0)).toBe(1);
    expect((await h.request(`${N}/drawings/${dropped.id}`)).status).toBe(404);
    expect((await h.request(`${N}/drawings/${shown.id}`)).status).toBe(200);

    await h.request(`${N}/pages/${page.id}`, { method: "DELETE" });
    expect(await sweepNotes(deps, 0)).toBe(1);
  });
});
