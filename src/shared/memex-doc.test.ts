import { describe, expect, it } from "vitest";
import { analyzePageDoc, effectApplies, emptyPageDoc, MAX_ELEMENTS, PageDocSchema, pageDimensions, type PageElement } from "./memex-doc.ts";

const base = { rotation: 0, opacity: 1, hidden: false, locked: false, effects: [], x: 0, y: 0, w: 10, h: 10 };
const sha = (c: string) => c.repeat(64);
const text = (id: string, ...paragraphs: string[]): PageElement => ({
  ...base,
  id,
  kind: "text",
  font: "sans",
  fontSize: 12,
  lineHeight: 1.2,
  align: "left",
  color: "#000000",
  content: { type: "doc", content: paragraphs.map((t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : undefined })) },
});

describe("memex page docs", () => {
  it("validates the format, the element kinds and their limits", () => {
    expect(PageDocSchema.safeParse(emptyPageDoc()).success).toBe(true);
    const bad = (patch: Record<string, unknown>) => PageDocSchema.safeParse({ ...emptyPageDoc(), ...patch }).success;
    expect(bad({ format: { size: "a4", orientation: "portrait", margin: 36 } })).toBe(false);
    expect(bad({ format: { size: "half", orientation: "portrait", margin: 30 } })).toBe(false);
    expect(bad({ elements: [{ ...base, id: "x", kind: "video", asset: sha("a") }] })).toBe(false);
    expect(bad({ elements: [{ ...base, id: "x", kind: "image", asset: "nope", fit: "contain" }] })).toBe(false);
    expect(bad({ elements: [{ ...base, id: "x", kind: "image", asset: sha("a"), fit: "contain", effects: [{ type: "halftone", cell: 0.1, angle: 45, shape: "circle", invert: false }] }] })).toBe(false);
    expect(bad({ elements: Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => text(`t${String(i)}`, "x")) })).toBe(false);
    expect(bad({ elements: [text("same", "a"), text("same", "b")] })).toBe(false);
  });

  it("reads older text boxes without a font as sans, and checks QR codes and frames", () => {
    const old = { ...base, id: "o", kind: "text", fontSize: 12, lineHeight: 1.2, align: "left", color: "#000000", content: { type: "doc", content: [] } };
    const parsed = PageDocSchema.parse({ ...emptyPageDoc(), elements: [old] });
    expect(parsed.elements[0]).toMatchObject({ kind: "text", font: "sans" });
    const qr = { ...base, id: "q", kind: "qr", text: "https://example.com", ecc: "M", color: "#000000", quiet: true };
    expect(PageDocSchema.safeParse({ ...emptyPageDoc(), elements: [qr, { ...base, id: "f", kind: "frame" }] }).success).toBe(true);
    expect(PageDocSchema.safeParse({ ...emptyPageDoc(), elements: [{ ...qr, text: "" }] }).success).toBe(false);
    expect(PageDocSchema.safeParse({ ...emptyPageDoc(), elements: [{ ...qr, ecc: "X" }] }).success).toBe(false);
  });

  it("swaps the dimensions for landscape", () => {
    expect(pageDimensions({ size: "half", orientation: "portrait" })).toEqual({ w: 396, h: 612 });
    expect(pageDimensions({ size: "quarter", orientation: "landscape" })).toEqual({ w: 396, h: 306 });
  });

  it("collects the text and the assets a page uses", () => {
    const doc = {
      ...emptyPageDoc(),
      elements: [
        text("a", "Title", "", "second line"),
        { ...base, id: "i", kind: "image", asset: sha("b"), fit: "contain" },
        { ...base, id: "d", kind: "excalidraw", asset: sha("c"), scene: sha("a"), fit: "contain" },
        { ...base, id: "j", kind: "image", asset: sha("b"), fit: "cover" },
        text("e", ""),
        { ...base, id: "q", kind: "qr", text: "https://example.com", ecc: "M", color: "#000000", quiet: true },
        { ...base, id: "f", kind: "frame" },
      ] satisfies PageElement[],
    };
    expect(analyzePageDoc(doc)).toEqual({ text: "Title\n\nsecond line\n\nhttps://example.com", assets: [sha("a"), sha("b"), sha("c")] });
  });

  it("knows which effects apply to which kinds", () => {
    expect(effectApplies("grayscale", "text")).toBe(true);
    expect(effectApplies("halftone", "text")).toBe(false);
    expect(effectApplies("halftone", "svg")).toBe(true);
  });
});
