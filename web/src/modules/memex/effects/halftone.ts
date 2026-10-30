// Grayscale halftone: dots on a rotated screen whose size follows how dark the source is under
// them. Pure: the renderer (Halftone.tsx) rasterises the source and hands over its brightness;
// this turns it into one SVG path, so print stays sharp and the DOM holds a single element.

import type { HalftoneEffect } from "../../../../../src/shared/memex-doc.ts";

// Brightness of the source, 0 (black) to 1 (white), sampled over a w x h raster that covers the
// element's box. Transparent pixels count as white (the paper).
export type Luminance = { width: number; height: number; at: (x: number, y: number) => number };

export type HalftoneParams = Pick<HalftoneEffect, "cell" | "angle" | "shape" | "invert">;

// Dots smaller than this (in points) are left out: invisible, and they bloat the path.
const MIN_SIZE = 0.05;
// A full dot covers its cell completely (the circle reaches the cell's corners).
const MAX_RADIUS = Math.SQRT1_2;

const round = (n: number) => Math.round(n * 100) / 100;

export function luminanceFromRgba(data: Uint8ClampedArray, width: number, height: number): Luminance {
  return {
    width,
    height,
    at(x, y) {
      const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
      const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
      const i = (py * width + px) * 4;
      const a = (data[i + 3] ?? 0) / 255;
      const lum = (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255;
      return lum * a + (1 - a);
    },
  };
}

// The halftone of `lum` over a box of w x h points, as an SVG path in that box's coordinates.
export function halftonePath(lum: Luminance, w: number, h: number, params: HalftoneParams): { d: string; dots: number } {
  const { cell, shape, invert } = params;
  const rad = (params.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  // Screen coordinates (u, v) rotated about the centre; enough of them to cover the box's corners.
  const reach = Math.ceil(Math.hypot(w, h) / 2 / cell) + 1;
  const sx = lum.width / w;
  const sy = lum.height / h;
  const parts: string[] = [];
  let dots = 0;
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const u = i * cell;
      const v = j * cell;
      const x = cx + u * cos - v * sin;
      const y = cy + u * sin + v * cos;
      if (x < -cell / 2 || y < -cell / 2 || x > w + cell / 2 || y > h + cell / 2) continue;
      const b = lum.at(x * sx, y * sy);
      const ink = invert ? b : 1 - b;
      if (ink <= 0) continue;
      if (shape === "circle") {
        const r = cell * MAX_RADIUS * Math.sqrt(ink);
        if (r < MIN_SIZE) continue;
        parts.push(`M${String(round(x - r))} ${String(round(y))}a${String(round(r))} ${String(round(r))} 0 1 0 ${String(round(2 * r))} 0a${String(round(r))} ${String(round(r))} 0 1 0 ${String(round(-2 * r))} 0`);
      } else {
        // A square whose area follows the ink, turned with the screen.
        const half = (cell * Math.sqrt(ink)) / 2;
        if (half * 2 < MIN_SIZE) continue;
        const corner = (a: number, b2: number) => `${String(round(x + a * cos - b2 * sin))} ${String(round(y + a * sin + b2 * cos))}`;
        parts.push(`M${corner(-half, -half)}L${corner(half, -half)}L${corner(half, half)}L${corner(-half, half)}Z`);
      }
      dots++;
    }
  }
  return { d: parts.join(""), dots };
}

// How finely to rasterise the source: a few pixels per cell average its tone under each dot.
export const samplesPerPoint = (cell: number) => Math.min(4, Math.max(0.25, 3 / cell));
