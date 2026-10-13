// Pure helpers for serving archived files over HTTP.

import { ArchiveError, type ByteStream } from "./ports.ts";

export type ByteRange = { start: number; end: number };

// Parses a single-range `Range` header against a file of `size` bytes.
// null: no usable header (serve everything with 200; multi-range requests are
// ignored too). "unsatisfiable": answer 416.
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, from, to] = m;
  if (from === "" && to === "") return null;
  if (from === "") {
    // suffix range: the last N bytes
    const n = Number(to);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return "unsatisfiable";
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return end < start ? null : { start, end };
}

// The Content-Type a stored file is served with. A type handler (never the request) picks each
// file's mime, and only the mimes below are sent as themselves: media and data a browser plays or
// parses but never runs. Anything else, including what a browser would render or execute
// (text/html, image/svg+xml, JavaScript, XML), goes out as plain text. Every response also carries
// nosniff, so a browser never second-guesses the type.
const FALLBACK_CONTENT_TYPE = "text/plain; charset=utf-8";
const servedAsIs = new Map<string, string>([
  ["text/plain", FALLBACK_CONTENT_TYPE],
  ["text/vtt", "text/vtt; charset=utf-8"],
  ["application/json", "application/json; charset=utf-8"],
  ["application/vnd.apple.mpegurl", "application/vnd.apple.mpegurl"],
  ["video/mp4", "video/mp4"],
  ["audio/mp4", "audio/mp4"],
  ["image/jpeg", "image/jpeg"],
  ["image/avif", "image/avif"],
  ["image/webp", "image/webp"],
]);

export function servedContentType(mime: string): string {
  return servedAsIs.get(mime.toLowerCase()) ?? FALLBACK_CONTENT_TYPE;
}

export function contentDisposition(name: string): string {
  const base = name.split("/").pop() ?? "file";
  const ascii = base.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

// Passes `stream` through, failing with ArchiveError "too_large" once more than `maxBytes` went by.
export function limitBytes(stream: ByteStream, maxBytes: number): ByteStream {
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) controller.error(new ArchiveError("too_large", `a file may be at most ${String(maxBytes)} bytes`));
        else controller.enqueue(chunk);
      },
    }),
  );
}
