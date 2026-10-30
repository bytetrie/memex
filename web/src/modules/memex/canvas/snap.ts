// Snapping while moving or resizing elements, in points. Pure.
//
// Targets are lines on each axis: the margins, the page edges and centre, other elements' edges
// and centres, and (when the grid snaps) the nearest grid line. A moved box snaps its left
// edge, centre or right edge (top, middle, bottom) to the closest target within `threshold`;
// a resized box snaps the edges being dragged. Snapped lines come back as guides to draw.

import type { Format, Grid } from "../../../../../src/shared/memex-doc.ts";
import { pageDimensions } from "../../../../../src/shared/memex-doc.ts";

export type Box = { x: number; y: number; w: number; h: number };
export type Targets = { xs: number[]; ys: number[]; grid: number | null };
export type Guides = { xs: number[]; ys: number[] };
export type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

export function snapTargets(format: Format, grid: Grid, others: Box[]): Targets {
  const page = pageDimensions(format);
  const m = format.margin;
  const xs = [0, m, page.w / 2, page.w - m, page.w];
  const ys = [0, m, page.h / 2, page.h - m, page.h];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys, grid: grid.snap ? grid.step : null };
}

type Hit = { delta: number; at: number } | null;

// The smallest correction that puts one of `values` on a target line, if within threshold.
function nearest(values: number[], lines: number[], grid: number | null, threshold: number): Hit {
  let best: Hit = null;
  const consider = (value: number, line: number) => {
    const delta = line - value;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: line };
  };
  for (const v of values) {
    for (const line of lines) consider(v, line);
    if (grid) consider(v, Math.round(v / grid) * grid);
  }
  return best;
}

// Moves `box` by (dx, dy), then snaps it. Returns the corrected offset and the guides hit.
export function snapMove(box: Box, dx: number, dy: number, targets: Targets, threshold: number): { dx: number; dy: number; guides: Guides } {
  const x = box.x + dx;
  const y = box.y + dy;
  const hx = nearest([x, x + box.w / 2, x + box.w], targets.xs, targets.grid, threshold);
  const hy = nearest([y, y + box.h / 2, y + box.h], targets.ys, targets.grid, threshold);
  return {
    dx: dx + (hx?.delta ?? 0),
    dy: dy + (hy?.delta ?? 0),
    guides: { xs: hx ? [hx.at] : [], ys: hy ? [hy.at] : [] },
  };
}

// Snaps the dragged edges of a resized box (the others stay put). Keeps at least `min` points.
export function snapResize(box: Box, edges: Edges, targets: Targets, threshold: number, min = 4): { box: Box; guides: Guides } {
  let { x, y, w, h } = box;
  const guides: Guides = { xs: [], ys: [] };
  if (edges.left || edges.right) {
    const hit = nearest([edges.left ? x : x + w], targets.xs, targets.grid, threshold);
    if (hit) {
      guides.xs.push(hit.at);
      if (edges.left) {
        const right = x + w;
        x = Math.min(hit.at, right - min);
        w = right - x;
      } else {
        w = Math.max(min, hit.at - x);
      }
    }
  }
  if (edges.top || edges.bottom) {
    const hit = nearest([edges.top ? y : y + h], targets.ys, targets.grid, threshold);
    if (hit) {
      guides.ys.push(hit.at);
      if (edges.top) {
        const bottom = y + h;
        y = Math.min(hit.at, bottom - min);
        h = bottom - y;
      } else {
        h = Math.max(min, hit.at - y);
      }
    }
  }
  return { box: { x, y, w, h }, guides };
}

// Resizes `start` by a pointer offset on the given edges. `keepAspect` scales both sides together.
export function resizeBox(start: Box, edges: Edges, dx: number, dy: number, keepAspect: boolean, min = 4): Box {
  let { x, y, w, h } = start;
  if (edges.left) {
    w = Math.max(min, start.w - dx);
    x = start.x + start.w - w;
  } else if (edges.right) {
    w = Math.max(min, start.w + dx);
  }
  if (edges.top) {
    h = Math.max(min, start.h - dy);
    y = start.y + start.h - h;
  } else if (edges.bottom) {
    h = Math.max(min, start.h + dy);
  }
  if (keepAspect && start.w > 0 && start.h > 0) {
    const horizontal = edges.left || edges.right;
    const vertical = edges.top || edges.bottom;
    // Corners follow the larger change; side handles drive the other side.
    const scale = horizontal && vertical ? Math.max(w / start.w, h / start.h) : horizontal ? w / start.w : h / start.h;
    w = Math.max(min, start.w * scale);
    h = Math.max(min, start.h * scale);
    x = edges.left ? start.x + start.w - w : horizontal ? start.x : start.x + (start.w - w) / 2;
    y = edges.top ? start.y + start.h - h : vertical ? start.y : start.y + (start.h - h) / 2;
  }
  return { x, y, w, h };
}

export function boundsOf(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}
