// yt-dlp's info JSON for a video: the fields the archive uses, the trimmed copy it keeps, and the
// file checks for what the runners produced. All of it is untrusted input from a runner: every
// field is optional, type-checked and length-capped, and a bad field is dropped, not fatal.

import { z } from "zod";

const str = (max: number) => z.string().max(max).optional().catch(undefined);
const num = z.number().nonnegative().optional().catch(undefined);

export const InfoSchema = z.object({
  id: str(200),
  title: str(1000),
  description: str(100_000),
  webpage_url: str(2000),
  extractor_key: str(100),
  channel: str(300),
  uploader: str(300),
  upload_date: z.string().regex(/^\d{8}$/).optional().catch(undefined),
  duration: num,
  subtitles: z.record(z.string(), z.unknown()).optional().catch(undefined),
  _version: z.object({ version: z.string().max(50) }).optional().catch(undefined),
});
export type Info = z.infer<typeof InfoSchema>;

// Large or noisy parts of the info JSON that the archive doesn't keep: every format with its URLs,
// thumbnails, request headers, caption URLs in every language, and the like.
const DROPPED = new Set([
  "formats",
  "requested_formats",
  "requested_downloads",
  "requested_subtitles",
  "thumbnails",
  "http_headers",
  "automatic_captions",
  "subtitles",
  "heatmap",
  "storyboards",
  "_format_sort_fields",
  "url",
  "manifest_url",
  "fragments",
  "filename",
  "_filename",
  "__files_to_move",
]);

export function trimInfo(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !DROPPED.has(key)));
}

// "20050423" -> "2005-04-23"
export const isoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

export function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) throw new Error("the info JSON is not an object");
  return parsed.data;
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

// File checks by their first bytes, before anything is imported.
export const looksLike = {
  mp4: (head: Uint8Array) => ascii(head, 4, 8) === "ftyp",
  jpeg: (head: Uint8Array) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  avif: (head: Uint8Array) => ascii(head, 4, 8) === "ftyp" && ["avis", "avif"].includes(ascii(head, 8, 12)),
};

// The HLS playlist the encode runner writes refers only to its one media file.
export function checkPlaylist(text: string, mediaName: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  if (lines[0] !== "#EXTM3U" || !lines.includes("#EXT-X-ENDLIST")) return false;
  const uris = [...text.matchAll(/URI="([^"]*)"/g)].map((m) => m[1]);
  return lines.every((l) => l === "" || l.startsWith("#") || l === mediaName) && uris.every((u) => u === mediaName);
}
