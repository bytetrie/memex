// Where a source image goes inside a box for each fit, like CSS object-fit (centred). Pure.

import type { ImageFit } from "../../../../../src/shared/memex-doc.ts";

export function fitRect(fit: ImageFit, srcW: number, srcH: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  if (fit === "fill" || srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = fit === "contain" ? Math.min(boxW / srcW, boxH / srcH) : Math.max(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
