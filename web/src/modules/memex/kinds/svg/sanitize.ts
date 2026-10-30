// Cleans a pasted, dropped or drawn SVG before it is uploaded. The server refuses SVGs that still
// hold any of this (src/server/memex/sniff.ts), and the app only shows SVGs through <img>, where
// nothing runs; this is the first of those layers (ideas/printable.md).
//
// Removed: scripts, embedded HTML and other documents (with everything inside them), event
// handlers, javascript: and external URLs (only same-document #refs, data: images and, in CSS,
// data: fonts stay), style sheets that import others, comments, processing instructions and
// doctypes. An internal DTD (entities) is refused outright.
//
// It works on the text, never through a DOM: a document made by DOMParser inherits the page's CSP,
// and an SVG's style attributes and <style> elements would each log a violation. Pure, so it is
// tested in node.

const DROP_ELEMENTS = new Set(["script", "foreignobject", "iframe", "embed", "object", "audio", "video", "canvas", "handler", "listener"]);

const LINK_ATTRS = new Set(["href", "xlink:href", "src"]);
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i;

const localName = (name: string) => (name.split(":").pop() ?? name).toLowerCase();
export const unsafeElement = (name: string) => DROP_ELEMENTS.has(localName(name));

// Whether a URL inside the SVG may stay: references within the document or data: images.
export const safeRef = (value: string) => value.trim().startsWith("#") || SAFE_DATA_IMAGE.test(value.trim());

// url(...) references in CSS that point outside the document (data: images and fonts stay: a
// drawing's SVG embeds its fonts, kinds/excalidraw/render.ts).
const EXTERNAL_CSS_URL = /url\(\s*(['"]?)(?!#|data:image\/(?:png|jpeg|gif|webp|avif);|data:font\/(?:woff2?|ttf|otf);)[^)]*\1\s*\)/i;

export function unsafeAttribute(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("on")) return true;
  if (LINK_ATTRS.has(n)) return !safeRef(value);
  if (/javascript:/i.test(value)) return true;
  if (n === "style") return EXTERNAL_CSS_URL.test(value) || /expression\s*\(/i.test(value);
  return false;
}

export function unsafeStyleSheet(css: string): boolean {
  return /@import/i.test(css) || EXTERNAL_CSS_URL.test(css) || /javascript:/i.test(css);
}

// CSS pixels per unit (a Map: the unit comes from the file).
const UNITS = new Map([["px", 1], ["pt", 4 / 3], ["in", 96], ["cm", 96 / 2.54], ["mm", 96 / 25.4]]);

// The size an SVG asks for, in CSS pixels: width/height when they are absolute, else the viewBox.
export function svgSize(attrs: { width: string | null; height: string | null; viewBox: string | null }): { w: number; h: number } | null {
  const toPx = (v: string | null) => {
    const m = v === null ? null : /^\s*([\d.]+)\s*(px|pt|in|cm|mm)?\s*$/.exec(v);
    if (!m?.[1]) return null;
    const n = Number(m[1]);
    const per = UNITS.get(m[2] ?? "px") ?? 1;
    return Number.isFinite(n) && n > 0 ? n * per : null;
  };
  const w = toPx(attrs.width);
  const h = toPx(attrs.height);
  const box = attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  const vw = box?.[2];
  const vh = box?.[3];
  const hasBox = vw !== undefined && vh !== undefined && vw > 0 && vh > 0;
  if (w && h) return { w, h };
  if (hasBox && w) return { w, h: (w * vh) / vw };
  if (hasBox && h) return { w: (h * vw) / vh, h };
  if (hasBox) return { w: vw, h: vh };
  return null;
}

const NAMED_ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);

// Attribute values as written may hide what they say behind entities (javascript&#58;).
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);?/gi, (m, e: string) => {
    const k = e.toLowerCase();
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : k.startsWith("#") ? parseInt(k.slice(1), 10) : null;
    if (code !== null) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
    return NAMED_ENTITIES.get(k) ?? m;
  });
}

type Attr = { name: string; raw: string };

const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const parseAttrs = (source: string): Attr[] => [...source.matchAll(ATTR)].map((m) => ({ name: m[1] ?? "", raw: (m[2] ?? m[3] ?? m[4] ?? "").replace(/"/g, "&quot;") }));

const writeAttrs = (attrs: Attr[]) => attrs.map((a) => ` ${a.name}="${a.raw}"`).join("");

// One token of the markup: a comment, CDATA, a processing instruction, a doctype, a tag, text.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>|<\/?[A-Za-z_][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;
const TAG = /^<(\/?)([^\s/>]+)([\s\S]*?)(\/?)>$/;

export type SanitizedSvg = { text: string; size: { w: number; h: number } };

// Cleans `source`. Throws when it is not an SVG document or declares entities.
export function sanitizeSvg(source: string): SanitizedSvg {
  const out: string[] = [];
  let dropping = 0; // depth inside an element being dropped (0: keeping)
  let style: { open: string; body: string[] } | null = null; // the <style> being collected
  let root: { attrs: Attr[]; at: number } | null = null;
  for (const m of source.replace(/^\uFEFF/, "").matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.startsWith("<!--") || tok.startsWith("<?")) continue;
    if (/^<!DOCTYPE/i.test(tok)) {
      if (tok.includes("[")) throw new Error("This SVG declares entities, which are not allowed.");
      continue;
    }
    const tag = TAG.exec(tok);
    if (!tag || tok.startsWith("<![CDATA[")) {
      // Text or CDATA, kept unless inside something dropped (a lone "<" is escaped).
      if (dropping || !root) continue;
      const text = tok === "<" ? "&lt;" : tok;
      if (style) style.body.push(text);
      else out.push(text);
      continue;
    }
    const [, closing, name = "", rest = "", selfClosing] = tag;
    if (closing) {
      if (dropping) dropping--;
      else if (style && localName(name) === "style") {
        if (!unsafeStyleSheet(style.body.join(""))) out.push(style.open, ...style.body, `</${name}>`);
        style = null;
      } else if (root) out.push(`</${name}>`);
      continue;
    }
    if (dropping) {
      if (!selfClosing) dropping++;
      continue;
    }
    if (!root && localName(name) !== "svg") throw new Error("This is not an SVG image.");
    if (unsafeElement(name)) {
      if (!selfClosing) dropping = 1;
      continue;
    }
    const attrs = parseAttrs(rest).filter((a) => !unsafeAttribute(a.name, decodeEntities(a.raw)));
    if (!root) {
      root = { attrs, at: out.length };
      out.push(""); // the root's start tag, written at the end (a size may be added)
      if (selfClosing) out.push("</svg>");
    } else if (localName(name) === "style" && !selfClosing) {
      style = { open: `<${name}${writeAttrs(attrs)}>`, body: [] };
    } else {
      out.push(`<${name}${writeAttrs(attrs)}${selfClosing ? "/" : ""}>`);
    }
  }
  if (!root) throw new Error("This is not an SVG image.");
  const rootAttrs = root.attrs;
  const get = (n: string) => rootAttrs.find((a) => a.name === n)?.raw ?? null;
  const size = svgSize({ width: get("width"), height: get("height"), viewBox: get("viewBox") }) ?? { w: 300, h: 150 };
  // An <img> needs a size to draw an SVG that only has a viewBox at its natural size.
  const sized = svgSize({ width: get("width"), height: get("height"), viewBox: null });
  const attrs = rootAttrs.filter((a) => a.name !== "xmlns" && (sized || (a.name !== "width" && a.name !== "height")));
  if (!sized) attrs.push({ name: "width", raw: String(size.w) }, { name: "height", raw: String(size.h) });
  out[root.at] = `<svg xmlns="http://www.w3.org/2000/svg"${writeAttrs(attrs)}>`;
  return { text: out.join(""), size };
}
