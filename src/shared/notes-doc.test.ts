import { describe, expect, it } from "vitest";
import { analyzeDoc, BLOCK_TEXT_MAX, DocSchema, MAX_BOOKMARKS, MAX_DOC_DEPTH, MAX_DOC_NODES, parseBookmarks, type Doc, type DocNode } from "./notes-doc.ts";

const P1 = "019a0000-0000-7000-8000-0000000000a1";
const E1 = "019a0000-0000-7000-8000-0000000000e1";
const D1 = "019a0000-0000-7000-8000-0000000000d1";

const text = (t: string): DocNode => ({ type: "text", text: t });
const para = (id: string, ...content: DocNode[]): DocNode => ({ type: "paragraph", attrs: { id }, content });

describe("analyzeDoc", () => {
  const doc: Doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { id: "h1", level: 1 }, content: [text("Plan")] },
      para("p1", text("See "), { type: "pageLink", attrs: { pageId: P1 } }, text(" and "), { type: "blockLink", attrs: { pageId: P1, blockId: "b9" } }),
      { type: "bulletList", content: [{ type: "listItem", content: [para("p2", text("item "), { type: "archiveLink", attrs: { entryId: E1, label: "x" } })] }] },
      { type: "archiveEmbed", attrs: { id: "e1", entryId: E1 } },
      { type: "drawing", attrs: { id: "d1", drawingId: D1 } },
      { type: "drawing", attrs: { id: "d2", drawingId: "not-a-uuid" } },
    ],
  };

  it("finds blocks, links, archive entries and drawings", () => {
    const a = analyzeDoc(doc);
    expect(a.blocks.map((b) => [b.id, b.type, b.text])).toEqual([
      ["h1", "heading", "Plan"],
      ["p1", "paragraph", "See  and "],
      ["p2", "paragraph", "item x"],
      ["e1", "archiveEmbed", ""],
      ["d1", "drawing", ""],
      ["d2", "drawing", ""],
    ]);
    expect(a.links).toEqual([
      { fromBlockId: "p1", toPageId: P1, toBlockId: null },
      { fromBlockId: "p1", toPageId: P1, toBlockId: "b9" },
    ]);
    expect(a.archiveIds).toEqual([E1]);
    expect(a.drawingIds).toEqual([D1]);
  });

  it("separates blocks by lines in the page text, and counts link labels as text", () => {
    expect(analyzeDoc(doc).text).toBe("Plan\nSee  and \nitem x\n\n\n");
  });

  it("keeps the first of duplicate block ids and caps block text", () => {
    const long = "x".repeat(BLOCK_TEXT_MAX + 10);
    const a = analyzeDoc({ type: "doc", content: [para("same", text(long)), para("same", text("second"))] });
    expect(a.blocks).toHaveLength(1);
    expect(a.blocks[0]?.text).toHaveLength(BLOCK_TEXT_MAX);
  });
});

describe("parseBookmarks", () => {
  it("keeps valid bookmarks, sorted by time, and drops the rest", () => {
    const value = [
      { t: 90, label: " Second " },
      { t: 12.5, label: "First" },
      { t: -1, label: "negative" },
      { t: Number.NaN, label: "nan" },
      { t: 5, label: "   " },
      { t: 5, label: "x".repeat(201) },
      { t: "5", label: "string time" },
      null,
      "junk",
    ];
    expect(parseBookmarks(value)).toEqual([
      { t: 12.5, label: "First" },
      { t: 90, label: "Second" },
    ]);
  });

  it("reads anything that isn't an array as none, and caps the count", () => {
    expect(parseBookmarks(undefined)).toEqual([]);
    expect(parseBookmarks({ t: 1, label: "a" })).toEqual([]);
    expect(parseBookmarks(Array.from({ length: MAX_BOOKMARKS + 5 }, (_, i) => ({ t: i, label: "b" })))).toHaveLength(MAX_BOOKMARKS);
  });

  it("makes an embed's bookmark labels its block text", () => {
    const a = analyzeDoc({
      type: "doc",
      content: [{ type: "archiveEmbed", attrs: { id: "v", entryId: E1, bookmarks: [{ t: 30, label: "the demo" }, { t: 3, label: "intro" }] } }],
    });
    expect(a.blocks.map((b) => b.text)).toEqual(["intro\nthe demo"]);
    expect(a.text).toBe("intro\nthe demo");
  });
});

describe("DocSchema", () => {
  it("accepts a Tiptap doc", () => {
    expect(DocSchema.safeParse({ type: "doc", content: [para("a", text("hi"))] }).success).toBe(true);
  });

  it("refuses a non-doc top node", () => {
    expect(DocSchema.safeParse({ type: "paragraph" }).success).toBe(false);
  });

  it("refuses docs nested too deep, without overflowing the stack", () => {
    let node: DocNode = text("deep");
    for (let i = 0; i < 100_000; i++) node = { type: "blockquote", content: [node] };
    expect(DocSchema.safeParse({ type: "doc", content: [node] }).success).toBe(false);
    let ok: DocNode = text("ok");
    for (let i = 0; i < MAX_DOC_DEPTH - 2; i++) ok = { type: "blockquote", content: [ok] };
    expect(DocSchema.safeParse({ type: "doc", content: [ok] }).success).toBe(true);
  });

  it("refuses docs with too many nodes", () => {
    const content = Array.from({ length: MAX_DOC_NODES }, () => ({ type: "paragraph" }));
    expect(DocSchema.safeParse({ type: "doc", content }).success).toBe(false);
  });
});
