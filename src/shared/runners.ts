// The protocol between the app and its runners (AGENTS.md "Runners"). One TCP connection is one job:
// the app writes one request line, the runner answers with event lines (NDJSON) and ends with
// `done` or `error`. Files go to $INCOMING_DIR/<dir>; the reply only names them.
// Both sides validate every line with these schemas; the app treats everything as untrusted.

import { z } from "zod";
import { VideoUrlSchema } from "./archive-types.ts";

// Must match the runner ports declared in devstack.toml on the host.
export const RUNNER_PORTS = { ytdlp: 9101, encode: 9102 } as const;
export type RunnerName = keyof typeof RUNNER_PORTS;

// Longest line either side accepts.
export const MAX_LINE_BYTES = 64 * 1024;

// A job folder directly inside $INCOMING_DIR, made by a runner (mkdtemp): never a path.
export const JobDirSchema = z.string().regex(/^job-[A-Za-z0-9_-]{6,58}$/, "expected a job folder name");

export const SubLangSchema = z.string().regex(/^[A-Za-z]{2,3}$/, "expected a language code such as en");

export const FetchRequestSchema = z.object({
  v: z.literal(1),
  op: z.literal("fetch"),
  url: VideoUrlSchema,
  maxHeight: z.number().int().min(144).max(4320),
  subLang: SubLangSchema,
});
export type FetchRequest = z.infer<typeof FetchRequestSchema>;

export const EncodeRequestSchema = z.object({
  v: z.literal(1),
  op: z.literal("encode"),
  dir: JobDirSchema,
  subLang: SubLangSchema,
});
export type EncodeRequest = z.infer<typeof EncodeRequestSchema>;

const text = (max: number) => z.string().max(max);

export const ProgressEventSchema = z.object({
  event: z.literal("progress"),
  stage: z.enum(["download", "encode"]),
  percent: z.number().min(0).max(100).nullable(),
  detail: text(200).optional(),
});
export const LogEventSchema = z.object({ event: z.literal("log"), line: text(2000) });
// Sent every few seconds while nothing else is, so a runner notices a closed connection (its write
// fails) and the app notices a stuck runner.
export const HeartbeatEventSchema = z.object({ event: z.literal("heartbeat") });
export const ErrorEventSchema = z.object({ event: z.literal("error"), message: text(2000) });

// What `ytdlp` leaves in the job folder: the merged download, yt-dlp's info JSON, the site's
// thumbnail converted to JPEG (if it had one) and subtitles in `subLang` (manual or automatic).
export const FetchedFileSchema = z.object({
  kind: z.enum(["video", "info", "thumbnail", "subtitles"]),
  name: z.string().refine((n) => /^video\.[a-z0-9]{2,5}$/.test(n) || /^video\.[A-Za-z0-9_-]{1,20}\.[a-z0-9]{2,5}$/.test(n), "unexpected file name"),
});
export const FetchDoneSchema = z.object({ event: z.literal("done"), dir: JobDirSchema, files: z.array(FetchedFileSchema).max(20) });
export type FetchDone = z.infer<typeof FetchDoneSchema>;

// What `encode` leaves in the job folder, at fixed names.
export const ENCODED_FILES = {
  playlist: "hls/index.m3u8",
  media: "hls/media.mp4",
  poster: "poster.jpg",
  thumb: "thumb.jpg",
  preview: "preview.avif",
  transcript: "transcript.vtt",
  info: "video.info.json",
} as const;
export type EncodedFileKind = keyof typeof ENCODED_FILES;

export const EncodeDoneSchema = z.object({
  event: z.literal("done"),
  dir: JobDirSchema,
  // Which of ENCODED_FILES exist (the playlist, media and info always do).
  files: z.array(z.enum(["playlist", "media", "poster", "thumb", "preview", "transcript", "info"])),
  probe: z.object({
    duration: z.number().nonnegative().nullable(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    vcodec: text(40),
    acodec: text(40).nullable(),
    transcoded: z.boolean(),
  }),
});
export type EncodeDone = z.infer<typeof EncodeDoneSchema>;

export const FetchEventSchema = z.discriminatedUnion("event", [ProgressEventSchema, LogEventSchema, HeartbeatEventSchema, ErrorEventSchema, FetchDoneSchema]);
export const EncodeEventSchema = z.discriminatedUnion("event", [ProgressEventSchema, LogEventSchema, HeartbeatEventSchema, ErrorEventSchema, EncodeDoneSchema]);
export type RunnerEvent = z.infer<typeof FetchEventSchema> | z.infer<typeof EncodeEventSchema>;
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
