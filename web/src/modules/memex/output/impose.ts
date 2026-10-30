// Imposition: where a page goes on the sheet it prints on. Pure, so the print view, the HTML
// export and the tests share it.
//
// - "single": the sheet is the page itself (its own size and orientation).
// - "copies": the page repeated to fill a US Letter sheet, in whichever orientation fits the most
//   (Half Letter: 2 up on landscape, Quarter Letter: 4 up on portrait). A Letter page is single.

import { PAGE_SIZES, pageDimensions, type Format, type Orientation, type PageSize } from "../../../../../src/shared/memex-doc.ts";

export const LAYOUTS = ["single", "copies"] as const;
export type Layout = (typeof LAYOUTS)[number];

// The named @page rule a sheet prints with (Print.module.css, export.css): one per size and
// orientation, since the CSP lets no stylesheet be generated at runtime.
export type SheetName = `${PageSize}-${Orientation}`;

export type Cell = { x: number; y: number; w: number; h: number };
export type Imposition = { sheet: { w: number; h: number; name: SheetName }; cells: Cell[] };

export function impose(format: Pick<Format, "size" | "orientation">, layout: Layout): Imposition {
  const page = pageDimensions(format);
  if (layout === "single" || format.size === "letter") {
    return { sheet: { ...page, name: `${format.size}-${format.orientation}` }, cells: [{ x: 0, y: 0, ...page }] };
  }
  let best: Imposition | null = null;
  for (const orientation of ["portrait", "landscape"] as const) {
    const sheet = pageDimensions({ size: "letter", orientation });
    const cols = Math.floor(sheet.w / page.w + 1e-9);
    const rows = Math.floor(sheet.h / page.h + 1e-9);
    if (cols * rows === 0 || (best && cols * rows <= best.cells.length)) continue;
    // Centred on the sheet (Half and Quarter tile Letter exactly, so this is 0).
    const x0 = (sheet.w - cols * page.w) / 2;
    const y0 = (sheet.h - rows * page.h) / 2;
    const cells: Cell[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * page.w, y: y0 + r * page.h, ...page });
    best = { sheet: { ...sheet, name: `letter-${orientation}` }, cells };
  }
  if (!best) throw new Error(`a ${PAGE_SIZES[format.size].label} page does not fit on a Letter sheet`);
  return best;
}

// Whether "copies" means anything for this format (more than one per sheet).
export const hasCopies = (format: Pick<Format, "size" | "orientation">) => impose(format, "copies").cells.length > 1;
