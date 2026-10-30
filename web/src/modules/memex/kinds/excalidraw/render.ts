// Turns an Excalidraw scene (drawn in the scratch pad, or copied from a notes drawing) into what an
// excalidraw element stores: a self-contained SVG and the scene JSON it came from (kept so the
// drawing can be opened and edited again). Loaded with import(), so Excalidraw stays its own chunk.
//
// Excalidraw's SVG export would subset its fonts with WebAssembly started through `new Function`,
// which the CSP refuses. So the export skips that, and the fonts the drawing's text uses are
// embedded whole, per unicode-range subset (fonts.ts, the list from vite.config.ts), as data: URLs:
// an SVG shown through <img> may load nothing from outside.

import { exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import manifest from "virtual:excalidraw-fonts";
import { fontFacesFor, parseFamilies } from "./fonts.ts";

// (Window.EXCALIDRAW_ASSET_PATH is declared in notes/editor/nodes/Drawing.tsx.)
// Our own copy of Excalidraw's fonts (vite.config.ts copies them to static/excalidraw/).
window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
const FONT_URL = "/excalidraw/fonts/";
const PADDING = 8;
const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_STANDIN = "data-memex-style";

// Excalidraw's SVG export sets a style attribute on every line of text (white-space: pre), which
// the CSP reports even on an element that is not in the page. While it runs, those go to a
// stand-in attribute, restored in the serialised text (which never becomes a DOM in this page).
// Only style attributes on SVG elements, only for the export's duration.
async function withStyleStandIn<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with an explicit `this` below
  const original = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    original.call(this, name === "style" && this instanceof SVGElement ? STYLE_STANDIN : name, value);
  };
  try {
    return await fn();
  } finally {
    Element.prototype.setAttribute = original;
  }
}

export type RenderedScene = { svg: string; scene: string; width: number; height: number };

export function restore(elements: unknown[]): readonly ExcalidrawElement[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- restoreElements repairs whatever element data it is given
  return restoreElements(elements as unknown as ExcalidrawElement[], null).filter((e) => !e.isDeleted);
}

async function dataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/woff2;base64,${btoa(binary)}`;
}

export async function renderScene(input: { elements: unknown[] }): Promise<RenderedScene> {
  const elements = restore(input.elements);
  if (elements.length === 0) throw new Error("The drawing is empty.");
  const svg = await withStyleStandIn(() =>
    exportToSvg({
      elements,
      appState: { exportBackground: false, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
      files: null,
      exportPadding: PADDING,
      skipInliningFonts: true,
    }),
  );
  const uses = [...svg.querySelectorAll("text")].map((t) => ({ families: parseFamilies(t.getAttribute("font-family") ?? ""), text: t.textContent }));
  const faces = fontFacesFor(manifest, uses);
  const rules = await Promise.all(
    faces.map(async (f) => `@font-face { font-family: "${f.family}"; src: url(${await dataUrl(FONT_URL + f.file)}) format("woff2");${f.unicodeRange ? ` unicode-range: ${f.unicodeRange};` : ""} }`),
  );
  for (const old of svg.querySelectorAll("style.style-fonts")) old.remove();
  if (rules.length) {
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = rules.join("\n");
    svg.prepend(style);
  }
  const scene = JSON.stringify({ type: "excalidraw", version: 2, source: "memex", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} });
  const text = new XMLSerializer().serializeToString(svg).replaceAll(` ${STYLE_STANDIN}="`, ' style="');
  return { svg: text, scene, width: Number(svg.getAttribute("width")) || 300, height: Number(svg.getAttribute("height")) || 150 };
}
