// The HTML output: one standalone file that reads as an ordinary web page on screen (the flowing
// view, FlowRender.tsx: a readable column that fits any window) and prints as the designed sheets,
// each a page of its own size (export.css hides one or the other). Made in the browser from the
// print view's rendered DOM, so effects (halftones) come out exactly as shown; every image becomes
// a data: URL and the fonts the pages use are embedded, so the file needs nothing else.
//
// Only reads markup (outerHTML) and builds the file as text; nothing is put into this page.

import exportCss from "./export.css?raw";
import { whenHalftonesDone } from "../effects/Halftone.tsx";

// The faces of each family (web/src/fonts.css); a family is embedded when the markup names it.
const FAMILIES = [
  { name: "TeX Gyre Heros", file: "texgyreheros" },
  { name: "TeX Gyre Termes", file: "texgyretermes" },
  { name: "TeX Gyre Cursor", file: "texgyrecursor" },
] as const;
const FACES = [
  { suffix: "regular", weight: 400, style: "normal" },
  { suffix: "italic", weight: 400, style: "italic" },
  { suffix: "bold", weight: 700, style: "normal" },
  { suffix: "bolditalic", weight: 700, style: "italic" },
] as const;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("could not read a file"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("could not read a file"));
    };
    reader.readAsDataURL(blob);
  });
}

async function fetchDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
  return dataUrl(await res.blob());
}

async function fontFaces(markup: string): Promise<string> {
  const used = FAMILIES.filter((f) => markup.includes(f.name));
  const faces = await Promise.all(
    used.flatMap((family) =>
      FACES.map(async (f) => {
        const src = await fetchDataUrl(`/fonts/${family.file}-${f.suffix}.woff2`);
        return `@font-face { font-family: "${family.name}"; src: url("${src}") format("woff2"); font-weight: ${String(f.weight)}; font-style: ${f.style}; }`;
      }),
    ),
  );
  return faces.join("\n");
}

const SETTLE_MS = 20_000;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => { setTimeout(resolve, 0); }));

// Waits until every halftone under `root` shows its dots: the work being done (whenHalftonesDone)
// and React having put the result in the page, which comes a moment later.
async function halftonesShown(root: HTMLElement): Promise<void> {
  const until = Date.now() + SETTLE_MS;
  while (root.querySelector('[data-halftone="pending"]')) {
    if (Date.now() > until) throw new Error("A halftone is taking too long; try again in a moment.");
    await whenHalftonesDone();
    await nextFrame();
  }
}

// The finished file for the print view's [data-memex-export] (the web view and the sheets).
export async function buildHtml(root: HTMLElement, title: string): Promise<string> {
  await halftonesShown(root);
  await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
  const clone = root.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error("nothing to export");
  // Class names are the app's hashed CSS modules, meaningless in the file; which view shows is
  // the file's stylesheet's business.
  for (const el of [clone, ...clone.querySelectorAll("*")]) {
    el.removeAttribute("class");
    el.removeAttribute("hidden");
  }
  const urls = new Map<string, Promise<string>>();
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src) continue;
    if (!urls.has(src)) urls.set(src, fetchDataUrl(src));
  }
  const inlined = new Map(await Promise.all([...urls].map(async ([src, p]) => [src, await p] as const)));
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    const data = src ? inlined.get(src) : undefined;
    if (data) img.setAttribute("src", data);
  }
  const fonts = await fontFaces(clone.outerHTML);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${fonts}\n${exportCss}</style>`,
    "</head>",
    "<body>",
    clone.innerHTML,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const fileName = (title: string) => `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "memex"}.html`;

export async function downloadHtml(root: HTMLElement, title: string): Promise<void> {
  const html = await buildHtml(root, title);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(title);
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
  }
}
