// What a paste or a drop onto a memex page becomes. Pure: it only looks at what the clipboard or
// the drop holds; insert.ts uploads and places the result.
//
// - image files -> image elements; SVG files -> svg elements
// - text that is an SVG document -> an svg element
// - Excalidraw's clipboard JSON ({ type: "excalidraw/clipboard" }, what Ctrl+C in a drawing
//   copies) -> an excalidraw element
// - any other text -> a text box

export type PastedFile = { type: string; name: string };

export type PasteInput = { files: PastedFile[]; text: string };

export type PasteAction =
  | { kind: "files"; images: number[]; svgs: number[] }
  | { kind: "excalidraw"; scene: { elements: unknown[]; files?: unknown } }
  | { kind: "svg"; text: string }
  | { kind: "text"; text: string };

const RASTER = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const RASTER_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

export const isSvgFile = (f: PastedFile) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name);
export const isImageFile = (f: PastedFile) => !isSvgFile(f) && (RASTER.has(f.type) || RASTER_EXT.test(f.name));

export function looksLikeSvg(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<svg") || ((t.startsWith("<?xml") || t.startsWith("<!--") || t.startsWith("<!DOCTYPE svg")) && t.includes("<svg"));
}

export function excalidrawClipboard(text: string): { elements: unknown[]; files?: unknown } | null {
  if (!text.trimStart().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || parsed.type !== "excalidraw/clipboard") return null;
    if (!("elements" in parsed) || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return null;
    return { elements: parsed.elements, files: "files" in parsed ? parsed.files : undefined };
  } catch {
    return null;
  }
}

export function classifyPaste({ files, text }: PasteInput): PasteAction | null {
  const images = files.flatMap((f, i) => (isImageFile(f) ? [i] : []));
  const svgs = files.flatMap((f, i) => (isSvgFile(f) ? [i] : []));
  if (images.length || svgs.length) return { kind: "files", images, svgs };
  const scene = excalidrawClipboard(text);
  if (scene) return { kind: "excalidraw", scene };
  if (looksLikeSvg(text)) return { kind: "svg", text };
  return text.trim() ? { kind: "text", text } : null;
}
