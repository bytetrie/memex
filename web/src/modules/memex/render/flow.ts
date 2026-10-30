// How a fixed page becomes a flowing web page (the HTML export's screen view, FlowRender.tsx).
// Pure. Elements are read top to bottom in rows: an element joins the row above when most of it
// sits beside that row (vertical overlap), and a row reads left to right. Each element keeps its
// share of the page's width, so the layout is roughly the page's, but it flows and wraps.

import { pageDimensions, type PageDoc, type PageElement } from "../../../../../src/shared/memex-doc.ts";

export type FlowItem = { el: PageElement; share: number };
// A lone element keeps its side of the page: left, centred or right.
export type FlowRow = { items: FlowItem[]; align: "start" | "center" | "end" };

// Elements that show in an output and are at least partly on the page.
export function visibleElements(doc: PageDoc): PageElement[] {
  const { w, h } = pageDimensions(doc.format);
  return doc.elements.filter((e) => !e.hidden && e.kind !== "frame" && e.x < w && e.y < h && e.x + e.w > 0 && e.y + e.h > 0);
}

export function flowRows(doc: PageDoc): FlowRow[] {
  const { w } = pageDimensions(doc.format);
  const content = w - 2 * doc.format.margin;
  const sorted = [...visibleElements(doc)].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { top: number; bottom: number; els: PageElement[] }[] = [];
  for (const el of sorted) {
    const row = rows.at(-1);
    const overlap = row ? Math.min(row.bottom, el.y + el.h) - Math.max(row.top, el.y) : 0;
    if (row && overlap > 0.5 * Math.min(el.h, row.bottom - row.top)) {
      row.els.push(el);
      row.bottom = Math.max(row.bottom, el.y + el.h);
    } else {
      rows.push({ top: el.y, bottom: el.y + el.h, els: [el] });
    }
  }
  return rows.map((row) => {
    const items = row.els.sort((a, b) => a.x - b.x).map((el) => ({ el, share: Math.min(1, Math.max(0.05, el.w / content)) }));
    const [only] = items;
    if (items.length !== 1 || only === undefined) return { items, align: "start" as const };
    const mid = only.el.x + only.el.w / 2;
    const align = Math.abs(mid - w / 2) < w * 0.05 ? ("center" as const) : mid > w / 2 && only.el.x + only.el.w > w - doc.format.margin - w * 0.05 ? ("end" as const) : ("start" as const);
    return { items, align };
  });
}
