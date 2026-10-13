// The archive's types (how an entry is added) and the input schema of each.
// Adding a type: AGENTS.md "Add an archive type". Add its id to
// ArchiveTypeIdSchema first; tsc then lists every registry that needs it.

import { z } from "zod";

export const ArchiveTypeIdSchema = z.enum(["file", "text", "video"]);
export type ArchiveTypeId = z.infer<typeof ArchiveTypeIdSchema>;

// The largest file the archive takes. Enforced on every hop: Caddy's request_body (infra/Caddyfile,
// keep the two equal), the upload route, and the browser before it uploads.
export const MAX_FILE_BYTES = 4 * 1024 ** 3; // 4 GiB

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");

// A file name inside an entry. May contain "/" (hls/index.m3u8) but no empty,
// "." or ".." segments, backslashes or control characters.
export function isValidFileName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  // eslint-disable-next-line no-control-regex -- finding control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return false;
  return name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export const FileNameSchema = z.string().refine(isValidFileName, "invalid file name");

export const MimeSchema = z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, "expected a mime type such as text/plain");

// type "file": text files already uploaded with PUT /archive/blobs, named here. The server
// refuses anything that is not UTF-8 text, and picks the stored mime type itself (`mime` is a hint).
export const FileInputSchema = z.object({
  files: z
    .array(z.object({ sha256: Sha256Schema, name: FileNameSchema, mime: MimeSchema.optional() }))
    .min(1)
    .max(100)
    .refine((files) => new Set(files.map((f) => f.name)).size === files.length, "file names must be unique"),
});
export type FileInput = z.infer<typeof FileInputSchema>;

// type "text": pasted text or Markdown, saved by the server as content.md.
export const TEXT_MAX_LENGTH = 1_000_000;
export const TextInputSchema = z.object({ text: z.string().trim().min(1).max(TEXT_MAX_LENGTH) });
export type TextInput = z.infer<typeof TextInputSchema>;

// type "video": a page URL that yt-dlp understands (YouTube, Vimeo, ...). Fetched by the `ytdlp` runner and
// converted by the `encode` runner, so it is added through POST /archive/jobs, not POST /archive/entries.
// https only, and no user:password in the URL; runners can't reach private networks anyway.
export function isFetchableUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "";
}
export const VideoUrlSchema = z.string().trim().max(2000).refine(isFetchableUrl, "expected an https:// URL without credentials");
export const VideoInputSchema = z.object({ url: VideoUrlSchema });
export type VideoInput = z.infer<typeof VideoInputSchema>;
