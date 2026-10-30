// Decides what an uploaded memex asset is from its bytes (the request's Content-Type is ignored).
// Only the types in ASSET_MIMES are kept; anything else is refused. SVG and scene JSON are text,
// read whole and checked further; raster images by their magic bytes.

import type { AssetMime } from "../../shared/memex.ts";

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

// The raster type of `head` (the first bytes of the file), or null.
export function rasterMime(head: Uint8Array): AssetMime | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const six = ascii(head, 0, 6);
  if (six === "GIF87a" || six === "GIF89a") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  // ISO BMFF: size, "ftyp", then the major brand.
  if (ascii(head, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(head, 8, 12))) return "image/avif";
  return null;
}

// Whether `head` could be the start of a text file (SVG or JSON); then the whole file is checked.
export function maybeText(head: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head).replace(/^\uFEFF/, "").trimStart();
  return text.startsWith("<") || text.startsWith("{");
}

// Things an SVG shown through <img> can't run anyway, refused regardless (the client strips them
// before uploading, web/src/modules/memex/kinds/svg/sanitize.ts): scripts, embedded HTML, event
// handlers, javascript: URLs and external references.
const UNSAFE_SVG = [/<script[\s>/]/i, /<foreignObject[\s>/]/i, /<iframe[\s>/]/i, /<embed[\s>/]/i, /<object[\s>/]/i, /\son[a-z]+\s*=/i, /javascript:/i, /@import/i, /<!ENTITY/i];

// Whether `text` is an SVG document: an optional XML declaration, comments and doctype, then <svg.
function isSvgRoot(text: string): boolean {
  let rest = text;
  for (;;) {
    rest = rest.trimStart();
    const close = rest.startsWith("<?xml") ? "?>" : rest.startsWith("<!--") ? "-->" : /^<!DOCTYPE svg/i.test(rest) ? ">" : null;
    if (close === null) break;
    const end = rest.indexOf(close);
    if (end === -1) return false;
    rest = rest.slice(end + close.length);
  }
  return /^<svg[\s>]/i.test(rest);
}

export type TextVerdict = { mime: AssetMime } | { error: string };

export function checkText(bytes: Uint8Array): TextVerdict {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").trim();
  } catch {
    return { error: "not valid UTF-8 text" };
  }
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "not valid JSON" };
    }
    // The only JSON asset is an Excalidraw scene: { type: "excalidraw", elements: [...] }.
    const ok = typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "excalidraw" && "elements" in parsed && Array.isArray(parsed.elements);
    return ok ? { mime: "application/json" } : { error: "JSON assets must be Excalidraw scenes" };
  }
  if (!isSvgRoot(text) || !/<\/svg>$/i.test(text)) return { error: "not an SVG document" };
  const unsafe = UNSAFE_SVG.find((re) => re.test(text));
  if (unsafe) return { error: `the SVG holds something that is not allowed (${unsafe.source})` };
  return { mime: "image/svg+xml" };
}
