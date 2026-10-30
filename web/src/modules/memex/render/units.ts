// Memex geometry is in points; CSS lengths are written in `pt`, so the screen, print and the
// exported HTML all lay out at the physical size. Style objects go through React's style prop
// (set through the DOM, which the CSP allows), never as HTML attributes.

import type { CSSProperties } from "react";
import type { PageElement } from "../../../../../src/shared/memex-doc.ts";

export const pt = (n: number) => `${String(Math.round(n * 1000) / 1000)}pt`;

// CSS pixels per point.
export const PX_PER_PT = 4 / 3;

// The face pages are set in (web/src/fonts.css); the export embeds it.
export const PAGE_FONT = "'TeX Gyre Heros', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Where an element sits, with its rotation, opacity and the effects CSS can do itself.
export function frameStyle(el: PageElement): CSSProperties {
  const style: CSSProperties = { position: "absolute", left: pt(el.x), top: pt(el.y), width: pt(el.w), height: pt(el.h) };
  if (el.rotation) style.transform = `rotate(${String(el.rotation)}deg)`;
  if (el.opacity < 1) style.opacity = el.opacity;
  if (el.effects.some((e) => e.type === "grayscale")) style.filter = "grayscale(1)";
  return style;
}

// A readable name for an element: its own, or its kind and (for text) the start of its text.
export function elementLabel(el: PageElement, kindLabel: string, text?: string): string {
  if (el.name) return el.name;
  const snippet = text?.replace(/\s+/g, " ").trim().slice(0, 32);
  return snippet ? `${kindLabel}: ${snippet}` : kindLabel;
}
