// Unit tests for the memex editor's pure parts: imposition, snapping, halftone, paste, the SVG
// sanitiser's rules and the doc commands.

import { describe, expect, it } from "vitest";
import { emptyPageDoc, type PageElement } from "../../../../src/shared/memex-doc.ts";
import { resizeBox, snapMove, snapResize, snapTargets } from "./canvas/snap.ts";
import { duplicateElements, removeElements, reorderElements, replaceElement, updateElements } from "./doc/commands.ts";
import { createDocStore } from "./doc/store.ts";
import { halftonePath, luminanceFromRgba, type Luminance } from "./effects/halftone.ts";
import { fontFacesFor, parseFamilies, parseUnicodeRange } from "./kinds/excalidraw/fonts.ts";
import { encodeQr, penalty, qrPath } from "./kinds/qr/encode.ts";
import { sanitizeSvg, svgSize, unsafeAttribute, unsafeElement, unsafeStyleSheet } from "./kinds/svg/sanitize.ts";
import { place } from "./insert.ts";
import { flowRows } from "./render/flow.ts";
import { hasCopies, impose } from "./output/impose.ts";
import { classifyPaste } from "./paste.ts";

const base = { rotation: 0, opacity: 1, hidden: false, locked: false, effects: [], w: 10, h: 10 };
const img = (id: string, x = 0, y = 0): PageElement => ({ ...base, id, x, y, kind: "image", asset: "a".repeat(64), fit: "contain" });
const docOf = (...elements: PageElement[]) => ({ ...emptyPageDoc(), elements });
const ids = (d: { elements: PageElement[] }) => d.elements.map((e) => e.id);

describe("impose", () => {
  it("prints a page on its own sheet", () => {
    expect(impose({ size: "quarter", orientation: "portrait" }, "single")).toEqual({ sheet: { w: 306, h: 396, name: "quarter-portrait" }, cells: [{ x: 0, y: 0, w: 306, h: 396 }] });
  });

  it("puts 2 Half Letter copies on a landscape Letter sheet, 4 Quarter Letter on portrait", () => {
    const half = impose({ size: "half", orientation: "portrait" }, "copies");
    expect(half.sheet).toEqual({ w: 792, h: 612, name: "letter-landscape" });
    expect(half.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [396, 0]]);

    const halfWide = impose({ size: "half", orientation: "landscape" }, "copies");
    expect(halfWide.sheet.name).toBe("letter-portrait");
    expect(halfWide.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [0, 396]]);

    const quarter = impose({ size: "quarter", orientation: "portrait" }, "copies");
    expect(quarter.sheet.name).toBe("letter-portrait");
    expect(quarter.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [306, 0], [0, 396], [306, 396]]);
    expect(impose({ size: "quarter", orientation: "landscape" }, "copies").sheet.name).toBe("letter-landscape");
  });

  it("prints Letter single even as copies", () => {
    expect(impose({ size: "letter", orientation: "portrait" }, "copies").cells).toHaveLength(1);
    expect(hasCopies({ size: "letter", orientation: "landscape" })).toBe(false);
    expect(hasCopies({ size: "half", orientation: "portrait" })).toBe(true);
  });
});

describe("snapping", () => {
  const format = { size: "half" as const, orientation: "portrait" as const, margin: 36 as const };
  const grid = { step: 9, show: false, snap: false };

  it("snaps a moved box's edges or centre to margins, the centre and other elements", () => {
    const targets = snapTargets(format, grid, [{ x: 200, y: 300, w: 50, h: 20 }]);
    // Left edge 2 pt from the margin.
    expect(snapMove({ x: 0, y: 100, w: 40, h: 40 }, 38, 0, targets, 4)).toMatchObject({ dx: 36, guides: { xs: [36] } });
    // Centre onto the page centre (198).
    expect(snapMove({ x: 0, y: 100, w: 40, h: 40 }, 177, 0, targets, 4).dx).toBe(178);
    // Top edge onto the other element's bottom (320).
    expect(snapMove({ x: 100, y: 0, w: 40, h: 40 }, 0, 318, targets, 4)).toMatchObject({ dy: 320, guides: { ys: [320] } });
    // Nothing near: unchanged.
    expect(snapMove({ x: 100, y: 0, w: 40, h: 40 }, 3, 51, targets, 1)).toEqual({ dx: 3, dy: 51, guides: { xs: [], ys: [] } });
  });

  it("snaps to the grid when it snaps", () => {
    const targets = snapTargets(format, { ...grid, snap: true }, []);
    expect(snapMove({ x: 0, y: 0, w: 10, h: 10 }, 100, 0, targets, 4).dx).toBe(99);
  });

  it("resizes from any handle, keeping the aspect with shift, and snaps the dragged edge", () => {
    const start = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeBox(start, { right: true }, 20, 0, false)).toEqual({ x: 10, y: 10, w: 120, h: 50 });
    expect(resizeBox(start, { left: true, top: true }, 10, 10, false)).toEqual({ x: 20, y: 20, w: 90, h: 40 });
    expect(resizeBox(start, { right: true, bottom: true }, 100, 0, true)).toEqual({ x: 10, y: 10, w: 200, h: 100 });
    expect(resizeBox(start, { left: true }, 500, 0, false).w).toBe(4);
    const targets = snapTargets(format, grid, []);
    expect(snapResize({ x: 10, y: 10, w: 24, h: 50 }, { right: true }, targets, 4).box.w).toBe(26);
  });
});

describe("halftone", () => {
  const flat = (value: number): Luminance => ({ width: 10, height: 10, at: () => value });

  it("draws full dots for black, none for white, and the opposite inverted", () => {
    const black = halftonePath(flat(0), 40, 40, { cell: 10, angle: 0, shape: "circle", invert: false });
    expect(black.dots).toBeGreaterThanOrEqual(16);
    expect(black.d).toMatch(/^M/);
    expect(halftonePath(flat(1), 40, 40, { cell: 10, angle: 0, shape: "circle", invert: false }).dots).toBe(0);
    expect(halftonePath(flat(1), 40, 40, { cell: 10, angle: 45, shape: "square", invert: true }).dots).toBeGreaterThan(0);
  });

  it("makes dots bigger where the source is darker", () => {
    const gradient: Luminance = { width: 100, height: 1, at: (x) => x / 100 };
    const { d } = halftonePath(gradient, 100, 10, { cell: 10, angle: 0, shape: "circle", invert: false });
    const radii = [...d.matchAll(/a([\d.]+) /g)].map((m) => Number(m[1])).filter((_, i) => i % 2 === 0);
    expect(radii[0]).toBeGreaterThan(radii.at(-1) ?? Infinity);
  });

  it("reads transparent pixels as paper", () => {
    const lum = luminanceFromRgba(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1);
    expect(lum.at(0, 0)).toBe(1);
    expect(lum.at(1, 0)).toBe(0);
  });
});

describe("paste", () => {
  it("tells images, SVGs, Excalidraw drawings and text apart", () => {
    expect(classifyPaste({ files: [{ type: "image/png", name: "a.png" }, { type: "", name: "b.svg" }, { type: "application/pdf", name: "c.pdf" }], text: "" })).toEqual({ kind: "files", images: [0], svgs: [1] });
    const scene = JSON.stringify({ type: "excalidraw/clipboard", elements: [{ id: "x" }], files: {} });
    expect(classifyPaste({ files: [], text: scene })).toMatchObject({ kind: "excalidraw", scene: { elements: [{ id: "x" }] } });
    expect(classifyPaste({ files: [], text: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>' })).toMatchObject({ kind: "svg" });
    expect(classifyPaste({ files: [], text: '{"type":"excalidraw/clipboard","elements":[]}' })).toMatchObject({ kind: "text" });
    expect(classifyPaste({ files: [], text: "Hello" })).toEqual({ kind: "text", text: "Hello" });
    expect(classifyPaste({ files: [], text: "  " })).toBeNull();
  });
});

describe("SVG sanitiser rules", () => {
  it("drops scripts, handlers and external references, keeps the drawing", () => {
    expect(unsafeElement("script")).toBe(true);
    expect(unsafeElement("foreignObject")).toBe(true);
    expect(unsafeElement("path")).toBe(false);
    expect(unsafeAttribute("onload", "x()")).toBe(true);
    expect(unsafeAttribute("href", "https://evil.example/x.svg")).toBe(true);
    expect(unsafeAttribute("xlink:href", "javascript:alert(1)")).toBe(true);
    expect(unsafeAttribute("href", "#shape")).toBe(false);
    expect(unsafeAttribute("href", "data:image/png;base64,AAAA")).toBe(false);
    expect(unsafeAttribute("href", "data:image/svg+xml;base64,AAAA")).toBe(true);
    expect(unsafeAttribute("style", "fill: url(https://x.example/a)")).toBe(true);
    expect(unsafeAttribute("style", "fill: url(#grad)")).toBe(false);
    expect(unsafeAttribute("fill", "red")).toBe(false);
    expect(unsafeStyleSheet("@import url(x.css);")).toBe(true);
    expect(unsafeStyleSheet(".a { fill: red }")).toBe(false);
  });

  it("reads the size from width and height or the viewBox", () => {
    expect(svgSize({ width: "100", height: "50", viewBox: null })).toEqual({ w: 100, h: 50 });
    expect(svgSize({ width: "1in", height: null, viewBox: "0 0 2 1" })).toEqual({ w: 96, h: 48 });
    expect(svgSize({ width: "100%", height: null, viewBox: "0 0 30 20" })).toEqual({ w: 30, h: 20 });
    expect(svgSize({ width: null, height: null, viewBox: null })).toBeNull();
  });
});

describe("doc commands and history", () => {
  it("keeps unchanged elements as the same objects", () => {
    const doc = docOf(img("a"), img("b"));
    const moved = updateElements(doc, ["b"], { x: 5 });
    expect(moved.elements[0]).toBe(doc.elements[0]);
    expect(moved.elements[1]).toMatchObject({ id: "b", x: 5 });
    expect(updateElements(doc, ["a"], { x: 0 })).toBe(doc);
  });

  it("reorders, duplicates and removes", () => {
    const doc = docOf(img("a"), img("b"), img("c"));
    expect(ids(reorderElements(doc, ["a"], "forward"))).toEqual(["b", "a", "c"]);
    expect(ids(reorderElements(doc, ["c"], "backward"))).toEqual(["a", "c", "b"]);
    expect(ids(reorderElements(doc, ["a", "b"], "front"))).toEqual(["c", "a", "b"]);
    expect(ids(reorderElements(doc, ["c"], "back"))).toEqual(["c", "a", "b"]);
    expect(reorderElements(doc, ["c"], "forward")).toBe(doc);
    let n = 0;
    const dup = duplicateElements(doc, ["b"], 9, () => `copy${String(++n)}`);
    expect(ids(dup.doc)).toEqual(["a", "b", "c", "copy1"]);
    expect(dup.doc.elements[3]).toMatchObject({ x: 9, y: 9 });
    expect(ids(removeElements(doc, ["b"]))).toEqual(["a", "c"]);
  });

  it("undoes and redoes, merging steps with the same key", () => {
    let changes = 0;
    const store = createDocStore(docOf(img("a")), () => {
      changes++;
    });
    store.commit(updateElements(store.getDoc(), ["a"], { x: 1 }), { merge: "x" });
    store.commit(updateElements(store.getDoc(), ["a"], { x: 12 }), { merge: "x" });
    store.commit(updateElements(store.getDoc(), ["a"], { y: 3 }));
    expect(store.element("a")).toMatchObject({ x: 12, y: 3 });
    store.undo();
    expect(store.element("a")).toMatchObject({ x: 12, y: 0 });
    store.undo();
    expect(store.element("a")).toMatchObject({ x: 0 });
    expect(store.getState().canUndo).toBe(false);
    store.redo();
    expect(store.element("a")).toMatchObject({ x: 12 });
    expect(changes).toBe(6);
  });

  it("shows a preview without recording a step", () => {
    const store = createDocStore(docOf(img("a"), img("b")));
    const b = store.element("b");
    store.preview(new Map([["a", { x: 50 }]]));
    expect(store.element("a")).toMatchObject({ x: 50 });
    expect(store.element("b")).toBe(b);
    expect(store.getDoc().elements[0]).toMatchObject({ x: 0 });
    store.preview(null);
    expect(store.element("a")).toMatchObject({ x: 0 });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe("SVG sanitiser", () => {
  it("drops scripts and embedded documents with what is inside them, handlers and external links", () => {
    const { text } = sanitizeSvg(
      '<?xml version="1.0"?><!-- made by hand --><svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" onload="x()"><script>alert(1)</script>' +
        '<foreignObject><div>hi</div></foreignObject><a href="javascript&#58;alert(1)"><rect width="5" height="5" style="fill:red"/></a>' +
        '<use xlink:href="#r"/><image href="https://evil.example/x.png"/><style>@import url(x.css);</style><style>.a{fill:url(#g)}</style></svg>',
    );
    expect(text).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><a><rect width="5" height="5" style="fill:red"/></a><use xlink:href="#r"/><image/><style>.a{fill:url(#g)}</style></svg>',
    );
  });

  it("keeps embedded fonts, adds a size to a viewBox-only SVG, and refuses what isn't one", () => {
    const font = "<style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style>";
    const out = sanitizeSvg(`<svg viewBox="0 0 30 20">${font}<text>Hi &amp; bye</text></svg>`);
    expect(out.text).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="30" height="20">${font}<text>Hi &amp; bye</text></svg>`);
    expect(out.size).toEqual({ w: 30, h: 20 });
    expect(() => sanitizeSvg("<html><body/></html>")).toThrow(/not an SVG/);
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toThrow(/entities/);
  });
});

describe("Excalidraw fonts for an SVG", () => {
  const manifest = {
    Excalifont: [
      { file: "Excalifont/latin.woff2", unicodeRange: "U+20-7e,U+a0-ff" },
      { file: "Excalifont/cyrillic.woff2", unicodeRange: "U+0400-045F" },
    ],
    Xiaolai: [{ file: "Xiaolai/a.woff2", unicodeRange: "U+4e00-4fff" }],
    Virgil: [{ file: "Virgil/all.woff2" }],
  };

  it("embeds only the subsets holding the characters used", () => {
    expect(parseUnicodeRange("U+20-7e, U+a0, U+4??")).toEqual([[0x20, 0x7e], [0xa0, 0xa0], [0x400, 0x4ff]]);
    expect(parseFamilies('Excalifont, "Xiaolai", Segoe UI Emoji')).toEqual(["Excalifont", "Xiaolai", "Segoe UI Emoji"]);
    const faces = fontFacesFor(manifest, [{ families: ["Excalifont", "Xiaolai", "Segoe UI Emoji"], text: "Hello" }, { families: ["Virgil"], text: "x" }]);
    expect(faces.map((f) => f.file)).toEqual(["Excalifont/latin.woff2", "Virgil/all.woff2"]);
    expect(fontFacesFor(manifest, [{ families: ["Excalifont", "Xiaolai"], text: "Привет中" }]).map((f) => f.file)).toEqual(["Excalifont/cyrillic.woff2", "Xiaolai/a.woff2"]);
  });
});

describe("QR codes", () => {
  it("picks the smallest version for the text and level", () => {
    expect(encodeQr("HELLO", "M")).toMatchObject({ version: 1, size: 21 });
    expect(encodeQr("x".repeat(100), "H").version).toBeGreaterThan(encodeQr("x".repeat(100), "L").version);
    expect(() => encodeQr("x".repeat(3000), "H")).toThrow(/Too much text/);
  });

  it("draws finder patterns in three corners, and the modules as one path", () => {
    const { modules, size } = encodeQr("https://example.com", "Q");
    const finderAt = (x0: number, y0: number) => [0, 6].every((d) => modules[y0 + d]?.slice(x0, x0 + 7).every(Boolean)) && modules[y0 + 1]?.[x0 + 1] === false;
    expect(finderAt(0, 0) && finderAt(size - 7, 0) && finderAt(0, size - 7)).toBe(true);
    expect(qrPath(encodeQr("A", "L"), 4)).toMatch(/^M4 4h7v1h-7z/);
    expect(penalty([[true, true], [true, true]])).toBeGreaterThan(penalty([[true, false], [false, true]]));
  });
});

describe("frames and flow", () => {
  const format = { size: "half" as const, orientation: "portrait" as const, margin: 36 as const };

  it("fits content inside a frame with its proportions", () => {
    expect(place(format, { w: 200, h: 100 }, undefined, { x: 50, y: 50, w: 100, h: 100 })).toEqual({ x: 50, y: 75, w: 100, h: 50 });
    expect(place(format, { w: 10, h: 10 }, undefined, { x: 0, y: 0, w: 40, h: 20 })).toEqual({ x: 10, y: 0, w: 20, h: 20 });
  });

  it("puts what fills a frame in its place in the layers", () => {
    const doc = docOf(img("a"), img("frame"), img("c"));
    expect(ids(replaceElement(doc, "frame", [img("new"), img("extra")]))).toEqual(["a", "new", "extra", "c"]);
  });

  it("reads a page as rows: side by side when they overlap vertically, top to bottom otherwise", () => {
    const at = (id: string, x: number, y: number, w: number, h: number): PageElement => ({ ...img(id, x, y), w, h });
    const doc = docOf(at("below", 36, 300, 100, 50), at("right", 200, 40, 150, 100), at("left", 36, 50, 150, 80), { ...at("hidden", 0, 0, 10, 10), hidden: true }, { ...at("frame", 0, 0, 9, 9), kind: "frame" });
    const rows = flowRows(doc);
    expect(rows.map((r) => r.items.map((i) => i.el.id))).toEqual([["left", "right"], ["below"]]);
    expect(rows[0]?.items[0]?.share).toBeCloseTo(150 / 324);
    expect(flowRows(docOf(at("mid", 148, 10, 100, 10)))[0]?.align).toBe("center");
    expect(flowRows(docOf(at("right", 288, 10, 72, 72)))[0]?.align).toBe("end");
    expect(flowRows(docOf(at("left", 36, 10, 72, 72)))[0]?.align).toBe("start");
  });
});
