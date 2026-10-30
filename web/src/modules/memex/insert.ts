// Adds pasted, dropped, picked or drawn content to a page: uploads it to the memex asset store,
// works out its natural size, and places it (paste.ts decides what it is).
//
// Where it goes: into an empty frame when there is one to fill (the one it was dropped on, or the
// selected one), fitted inside it with its proportions and taking the frame's place in the layers;
// otherwise on top at its natural size (96 css px per inch), scaled down to fit inside the margin,
// centred on the drop point or the page.

import { effectApplies, pageDimensions, type Format, type PageElement, type QrEcc, type TextElement } from "../../../../src/shared/memex-doc.ts";
import type { DocNode } from "../../../../src/shared/notes-doc.ts";
import { memexAssetUrl, uploadMemexAsset } from "../../api.ts";
import type { Box } from "./canvas/snap.ts";
import { addElements, newId, replaceElement, updateElements } from "./doc/commands.ts";
import type { DocStore } from "./doc/store.ts";
import { sanitizeSvg } from "./kinds/svg/sanitize.ts";
import { classifyPaste, isImageFile, isSvgFile, type PasteAction } from "./paste.ts";

export type Point = { x: number; y: number };
// Where new content goes: a drop point, or an empty frame to fill.
export type Target = { at?: Point; frame?: string };

const PT_PER_PX = 0.75;
const BASE = { rotation: 0, opacity: 1, hidden: false, locked: false, effects: [] };
const QR_SIZE = 108;

// A box for content of `size` (points): fitted inside `area` with its proportions and centred in
// it, or else at its natural size, scaled down to fit the margin, centred on `at` (or the page).
export function place(format: Format, size: { w: number; h: number }, at?: Point, area?: Box): Box {
  if (area) {
    const scale = Math.min(area.w / size.w, area.h / size.h);
    const w = Math.max(4, size.w * scale);
    const h = Math.max(4, size.h * scale);
    return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
  }
  const page = pageDimensions(format);
  const m = format.margin;
  const scale = Math.min(1, (page.w - 2 * m) / size.w, (page.h - 2 * m) / size.h);
  const w = Math.max(4, size.w * scale);
  const h = Math.max(4, size.h * scale);
  const c = at ?? { x: page.w / 2, y: page.h / 2 };
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return { x: clamp(c.x - w / 2, m, page.w - m - w), y: clamp(c.y - h / 2, m, page.h - m - h), w, h };
}

const loadSize = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { w: img.naturalWidth * PT_PER_PX, h: img.naturalHeight * PT_PER_PX };
};

export function textContent(text: string): DocNode {
  return {
    type: "doc",
    content: text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}

// A text box fills an area exactly; otherwise it is sized for its lines.
export function newTextBox(format: Format, text: string, at?: Point, area?: Box): TextElement {
  const lines = Math.max(1, text.split("\n").length);
  const box = area ?? place(format, { w: Math.min(260, pageDimensions(format).w - 2 * format.margin), h: Math.min(400, 12 * 1.25 * lines + 6) }, at);
  return { ...BASE, ...box, id: newId(), kind: "text", content: textContent(text), font: "sans", fontSize: 12, lineHeight: 1.25, align: "left", color: "#000000" };
}

export function newQr(format: Format, text: string, ecc: QrEcc, area?: Box): PageElement {
  return { ...BASE, ...place(format, { w: QR_SIZE, h: QR_SIZE }, undefined, area), id: newId(), kind: "qr", text, ecc, color: "#000000", quiet: true };
}

async function imageElement(format: Format, file: Blob, at?: Point, area?: Box): Promise<PageElement> {
  const asset = await uploadMemexAsset(file);
  const size = await loadSize(memexAssetUrl(asset.sha256));
  return { ...BASE, ...place(format, size, at, area), id: newId(), kind: "image", asset: asset.sha256, fit: "contain" };
}

async function svgElement(format: Format, source: string, at?: Point, area?: Box): Promise<PageElement> {
  const clean = sanitizeSvg(source);
  const asset = await uploadMemexAsset(new Blob([clean.text], { type: "image/svg+xml" }));
  const size = { w: clean.size.w * PT_PER_PX, h: clean.size.h * PT_PER_PX };
  return { ...BASE, ...place(format, size, at, area), id: newId(), kind: "svg", asset: asset.sha256, fit: "contain" };
}

// Renders a scene to SVG (kinds/excalidraw/render.ts) and uploads it with the scene.
async function renderDrawing(scene: { elements: unknown[] }): Promise<{ asset: string; scene: string; size: { w: number; h: number } }> {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  const { renderScene } = await import("./kinds/excalidraw/render.ts");
  const rendered = await renderScene(scene);
  const clean = sanitizeSvg(rendered.svg);
  const [svg, json] = await Promise.all([uploadMemexAsset(new Blob([clean.text], { type: "image/svg+xml" })), uploadMemexAsset(new Blob([rendered.scene], { type: "application/json" }))]);
  return { asset: svg.sha256, scene: json.sha256, size: { w: rendered.width * PT_PER_PX, h: rendered.height * PT_PER_PX } };
}

async function excalidrawElement(format: Format, scene: { elements: unknown[] }, at?: Point, area?: Box): Promise<PageElement> {
  const drawing = await renderDrawing(scene);
  return { ...BASE, ...place(format, drawing.size, at, area), id: newId(), kind: "excalidraw", asset: drawing.asset, scene: drawing.scene, fit: "contain" };
}

// Makes the elements an action asks for (several dropped files cascade a little).
async function elementsFor(format: Format, action: PasteAction, files: File[], at?: Point, area?: Box): Promise<PageElement[]> {
  switch (action.kind) {
    case "text":
      return [newTextBox(format, action.text, at, area)];
    case "svg":
      return [await svgElement(format, action.text, at, area)];
    case "excalidraw":
      return [await excalidrawElement(format, action.scene, at, area)];
    case "files": {
      const out: PageElement[] = [];
      for (const [n, file] of files.entries()) {
        // Only the first file fills the frame; the others land beside it.
        const into = n === 0 ? area : undefined;
        const shifted = at ? { x: at.x + n * 12, y: at.y + n * 12 } : undefined;
        if (isSvgFile(file)) out.push(await svgElement(format, await file.text(), shifted, into));
        else if (isImageFile(file)) out.push(await imageElement(format, file, shifted, into));
      }
      return out;
    }
  }
}

// The frame new content should fill: the one named, else the only element selected if it is one.
function frameFor(store: DocStore, target: Target): (PageElement & { kind: "frame" }) | null {
  const { selection } = store.getState();
  const id = target.frame ?? (selection.length === 1 ? selection[0] : undefined);
  const el = id === undefined ? undefined : store.element(id);
  return el?.kind === "frame" ? el : null;
}

// Puts new elements on the page: into the frame (its place in the layers, its name and the
// effects that still apply carried over), or on top.
export function commitElements(store: DocStore, elements: PageElement[], frame: (PageElement & { kind: "frame" }) | null): void {
  const [first, ...rest] = elements;
  if (!first) return;
  const doc = store.getDoc();
  if (frame) {
    const filled: PageElement = { ...first, name: frame.name, effects: frame.effects.filter((e) => effectApplies(e.type, first.kind)) };
    store.commit(replaceElement(doc, frame.id, [filled, ...rest]), { select: [filled.id, ...rest.map((e) => e.id)] });
  } else {
    store.commit(addElements(doc, elements), { select: elements.map((e) => e.id) });
  }
}

// Inserts what a clipboard or a drop holds; returns how many elements were added (0: nothing usable).
export async function insertData(store: DocStore, data: { files: File[]; text: string }, target: Target = {}): Promise<number> {
  const action = classifyPaste({ files: data.files.map((f) => ({ type: f.type, name: f.name })), text: data.text });
  if (!action) return 0;
  const frame = frameFor(store, target);
  const files = action.kind === "files" ? data.files.filter((_, i) => action.images.includes(i) || action.svgs.includes(i)) : [];
  const elements = await elementsFor(store.getDoc().format, action, files, target.at, frame ?? undefined);
  // The doc as it is now (another edit may have happened while uploading), and the frame only
  // if it is still there.
  commitElements(store, elements, frame && store.element(frame.id) ? frame : null);
  return elements.length;
}

// A drawing from the scratch pad: replaces the drawing it was opened from (same place and width,
// its new proportions), or goes in like a paste (into a selected frame, or on top).
export async function insertDrawing(store: DocStore, scene: { elements: unknown[] }, replace?: string): Promise<void> {
  const old = replace === undefined ? undefined : store.element(replace);
  if (old?.kind === "excalidraw") {
    const drawing = await renderDrawing(scene);
    const h = old.w * (drawing.size.h / drawing.size.w);
    store.commit(updateElements(store.getDoc(), [old.id], { asset: drawing.asset, scene: drawing.scene, h }), { select: [old.id] });
    return;
  }
  const frame = frameFor(store, {});
  const el = await excalidrawElement(store.getDoc().format, scene, undefined, frame ?? undefined);
  commitElements(store, [el], frame && store.element(frame.id) ? frame : null);
}

export function insertQr(store: DocStore, text: string, ecc: QrEcc): void {
  const frame = frameFor(store, {});
  commitElements(store, [newQr(store.getDoc().format, text, ecc, frame ?? undefined)], frame);
}

export function insertTextBox(store: DocStore, text = "Text"): string {
  const frame = frameFor(store, {});
  const box = newTextBox(store.getDoc().format, text, undefined, frame ?? undefined);
  commitElements(store, [box], frame);
  return box.id;
}

// An empty frame drawn on the page (Box in points).
export function insertFrame(store: DocStore, box: Box): string {
  const id = newId();
  store.commit(addElements(store.getDoc(), [{ ...BASE, ...box, id, kind: "frame" }]), { select: [id] });
  return id;
}
