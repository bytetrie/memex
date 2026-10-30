// Renders the halftone effect: rasterises the element's source (an asset served from our own
// origin, so the canvas is never tainted) at a few samples per cell, measures its brightness and
// draws the dots as one SVG path (halftone.ts). Results are cached by source, size and params.
// While the box is being resized the previous dots stretch along, and the new ones are worked out
// a moment after it stops. Every run counts in `halftones` so the HTML export can wait for them.

import { memo, useEffect, useState, type ReactElement } from "react";
import type { ImageFit } from "../../../../../src/shared/memex-doc.ts";
import { fitRect } from "./fit.ts";
import { halftonePath, luminanceFromRgba, samplesPerPoint, type HalftoneParams } from "./halftone.ts";

const DELAY_MS = 120;
const CACHE_MAX = 64;
// Keeps the raster small enough for any page (a Letter page at 3 samples per point).
const MAX_SAMPLES = 2500;

type Result = { d: string; w: number; h: number };
const cache = new Map<string, Result>();

// Halftones being worked out, for the export to wait on (whenHalftonesDone).
let running = 0;
let waiting: (() => void)[] = [];
const started = () => {
  running++;
};
const finished = () => {
  running--;
  if (running > 0) return;
  for (const resolve of waiting) resolve();
  waiting = [];
};
export const whenHalftonesDone = (): Promise<void> => (running === 0 ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve)));

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

async function compute(src: string, fit: ImageFit, w: number, h: number, params: HalftoneParams): Promise<Result> {
  const img = await loadImage(src);
  const spp = Math.min(samplesPerPoint(params.cell), MAX_SAMPLES / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * spp));
  const ch = Math.max(1, Math.round(h * spp));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D canvas");
  const r = fitRect(fit, img.naturalWidth, img.naturalHeight, cw, ch);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const lum = luminanceFromRgba(ctx.getImageData(0, 0, cw, ch).data, cw, ch);
  return { d: halftonePath(lum, w, h, params).d, w, h };
}

const keyOf = (src: string, fit: ImageFit, w: number, h: number, p: HalftoneParams) =>
  [src, fit, w.toFixed(1), h.toFixed(1), String(p.cell), String(p.angle), p.shape, String(p.invert)].join("|");

export const Halftone = memo(function Halftone({ src, fit, w, h, params }: { src: string; fit: ImageFit; w: number; h: number; params: HalftoneParams }): ReactElement {
  const key = keyOf(src, fit, w, h, params);
  const [result, setResult] = useState<Result | null>(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setResult(hit);
      return;
    }
    let cancelled = false;
    let fired = false;
    started();
    const timer = setTimeout(() => {
      fired = true;
      compute(src, fit, w, h, params)
        .then((r) => {
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value ?? "");
          cache.set(key, r);
          if (!cancelled) {
            setResult(r);
            setFailed(false);
          }
        })
        .catch((err: unknown) => {
          console.warn("memex: halftone failed", err);
          if (!cancelled) setFailed(true);
        })
        .finally(finished);
    }, DELAY_MS);
    return () => {
      cancelled = true;
      if (fired) return;
      // Not started yet: it never will be.
      clearTimeout(timer);
      finished();
    };
  }, [key]); // the key holds src, fit, size and params

  if (failed && !result) return <svg width="100%" height="100%" role="img" aria-label="Halftone (the image didn't load)" />;
  return (
    <svg width="100%" height="100%" viewBox={result ? `0 0 ${String(result.w)} ${String(result.h)}` : `0 0 ${String(w)} ${String(h)}`} preserveAspectRatio="none" role="img" aria-label="Halftone" data-halftone={result ? "ready" : "pending"}>
      {result && <path d={result.d} fill="#000" />}
    </svg>
  );
});
