// Runner `encode`: turns a `ytdlp` job folder into what the archive keeps. That is HLS (one fMP4
// file with byte ranges, remuxed without re-encoding when the codecs allow), a poster, a small
// thumbnail, a small animated AVIF preview and the chosen subtitles. It deletes the download.
// Protocol: src/shared/runners.ts (op "encode"). Declared on the host as `node scripts/runners/encode.ts`.
// It reads only the job folder the request names (made by `ytdlp`, inside $INCOMING_DIR).

import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ENCODED_FILES, EncodeRequestSchema, type EncodeDone, type EncodeRequest } from "../../src/shared/runners.ts";
import { makeSubdir, openJobDir, runTool, serve, toolEnv, type JobIo, type ToolResult } from "./lib.ts";

const FFMPEG = "/usr/bin/ffmpeg";
const FFPROBE = "/usr/bin/ffprobe";
// Codecs fMP4 HLS carries and Chromium/Firefox MSE play: these are copied, anything else re-encoded.
const COPY_VIDEO = new Set(["h264", "vp9", "av1"]);
const COPY_AUDIO = new Set(["aac", "opus"]);
export const PREVIEW = { frames: 12, fps: 2, width: 320 } as const;
const POSTER_WIDTH = 1280;
const THUMB_WIDTH = 320;

const ProbeSchema = z.object({
  streams: z.array(
    z.object({
      index: z.number(),
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      disposition: z.object({ attached_pic: z.number().optional() }).optional(),
    }),
  ),
  format: z.object({ duration: z.string().optional() }).optional(),
});

export type Plan = {
  video: { index: number; codec: string; width: number; height: number; copy: boolean };
  audio: { index: number; codec: string; copy: boolean } | null;
  duration: number | null;
};

// What ffprobe found and what to do with it. Throws when there is no video stream.
export function plan(probeJson: string): Plan {
  const probe = ProbeSchema.parse(JSON.parse(probeJson));
  const video = probe.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic && s.width && s.height);
  if (!video?.width || !video.height) throw new Error("the download has no video stream");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  const vcodec = video.codec_name ?? "unknown";
  const acodec = audio?.codec_name ?? "unknown";
  return {
    video: { index: video.index, codec: vcodec, width: video.width, height: video.height, copy: COPY_VIDEO.has(vcodec) },
    audio: audio ? { index: audio.index, codec: acodec, copy: COPY_AUDIO.has(acodec) } : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

export function hlsArgs(input: string, p: Plan, outDir: string): string[] {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", input];
  args.push("-map", `0:${String(p.video.index)}`);
  if (p.audio) args.push("-map", `0:${String(p.audio.index)}`);
  args.push(...(p.video.copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]));
  if (p.audio) args.push(...(p.audio.copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"]));
  args.push(
    "-f", "hls",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "single_file",
    "-hls_playlist_type", "vod",
    "-hls_time", "6",
    "-hls_segment_filename", join(outDir, "media.mp4"),
    join(outDir, "index.m3u8"),
  );
  return args;
}

// Seconds to grab preview frames at: evenly from 5 % to 95 % of the video.
export function frameTimes(duration: number, count: number = PREVIEW.frames): number[] {
  if (count === 1) return [duration / 2];
  return Array.from({ length: count }, (_, i) => duration * (0.05 + (0.9 * i) / (count - 1)));
}

// The subtitles to keep: `lang` itself, else a regional variant (en-US), else the original-language
// track (en-orig); null if none.
export function pickSubtitles(names: string[], lang: string): string | null {
  const of = (name: string) => /^video\.([A-Za-z0-9_-]+)\.vtt$/.exec(name)?.[1];
  const tracks = names.map((name) => ({ name, code: of(name) })).filter((t) => t.code !== undefined);
  const exact = tracks.find((t) => t.code === lang);
  const regional = tracks.filter((t) => t.code?.startsWith(`${lang}-`) && t.code !== `${lang}-orig`).sort((a, b) => a.name.localeCompare(b.name))[0];
  const orig = tracks.find((t) => t.code === `${lang}-orig`);
  return (exact ?? regional ?? orig)?.name ?? null;
}

// ffmpeg -progress output: "out_time_us=12345678" lines.
export function progressPercent(line: string, duration: number | null): number | null {
  const m = /^out_time_us=(\d+)$/.exec(line);
  if (!m || !duration) return null;
  return Math.min(100, Math.round((Number(m[1]) / 1e6 / duration) * 1000) / 10);
}

const failed = (what: string, r: ToolResult) => new Error(`${what} failed: ${r.stderrTail.slice(-3).join(" / ") || `exit ${String(r.code)}`}`);

async function encode(req: EncodeRequest, io: JobIo): Promise<EncodeDone> {
  const dir = await openJobDir(req.dir);
  const work = join(dir, ".work");
  await rm(work, { recursive: true, force: true });
  await makeSubdir(work);
  const env = toolEnv(work);
  const tool = (cmd: string, args: string[], onStdout?: (line: string) => void) =>
    runTool(cmd, args, {
      cwd: work,
      env,
      signal: io.signal,
      onStdout,
      onStderr: (line) => {
        if (!line.startsWith("Svt[info]")) io.log(line); // SVT-AV1's banner, on every run
      },
    });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the job folder, validated by openJobDir
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  const download = names.find((n) => /^video\.(mp4|mkv|webm)$/.test(n));
  if (!download) throw new Error("no downloaded video in the job folder");
  if (!names.includes(ENCODED_FILES.info)) throw new Error("no info JSON in the job folder");
  const input = join(dir, download);

  // 1. What is in it.
  const probeLines: string[] = [];
  const probe = await tool(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], (line) => probeLines.push(line));
  if (probe.code !== 0) throw failed("ffprobe", probe);
  const p = plan(probeLines.join("\n"));
  const transcoded = !p.video.copy || (p.audio !== null && !p.audio.copy);
  io.log(`video ${p.video.codec} ${String(p.video.width)}x${String(p.video.height)}, audio ${p.audio?.codec ?? "none"}: ${transcoded ? "re-encoding" : "remuxing"}`);

  // 2. HLS.
  io.progress({ stage: "encode", percent: 0, detail: transcoded ? "Re-encoding to HLS" : "Converting to HLS" });
  const hlsDir = join(dir, "hls");
  await makeSubdir(hlsDir);
  const hls = await tool(FFMPEG, hlsArgs(input, p, hlsDir), (line) => {
    const pct = progressPercent(line, p.duration);
    if (pct !== null) io.progress({ stage: "encode", percent: pct, detail: transcoded ? "Re-encoding to HLS" : "Converting to HLS" });
  });
  if (io.signal.aborted) throw new Error("cancelled");
  if (hls.code !== 0) throw failed("ffmpeg (HLS)", hls);
  const files: EncodeDone["files"] = ["playlist", "media", "info"];

  // 3. Images. Not essential: a failure is logged and the entry goes without.
  io.progress({ stage: "encode", percent: null, detail: "Making images" });
  const fit = (w: number) => `scale='min(${String(w)},iw)':-2`;
  const sourceJpg = names.includes("video.jpg") ? join(dir, "video.jpg") : null;
  const poster = join(dir, ENCODED_FILES.poster);
  // The site's thumbnail is re-encoded too, so nothing from it reaches the archive unprocessed.
  let made = sourceJpg !== null && (await tool(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", sourceJpg, "-frames:v", "1", "-vf", fit(POSTER_WIDTH), "-q:v", "3", poster])).code === 0;
  if (!made) {
    const at = String((p.duration ?? 0) * 0.1);
    made = (await tool(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", at, "-i", input, "-frames:v", "1", "-vf", fit(POSTER_WIDTH), "-q:v", "3", poster])).code === 0;
  }
  if (made) {
    files.push("poster");
    const thumb = await tool(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", poster, "-frames:v", "1", "-vf", fit(THUMB_WIDTH), "-q:v", "4", join(dir, ENCODED_FILES.thumb)]);
    if (thumb.code === 0) files.push("thumb");
    else io.log("thumbnail failed; going without");
  } else io.log("poster failed; going without");

  if (p.duration) {
    let ok = true;
    for (const [i, t] of frameTimes(p.duration).entries()) {
      const frame = join(work, `frame_${String(i + 1).padStart(4, "0")}.png`);
      const r = await tool(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", input, "-frames:v", "1", "-vf", `scale=${String(PREVIEW.width)}:-2`, frame]);
      if (r.code !== 0) ok = false;
    }
    // The settings tested on the user's machine (fast, plays in browsers); no alpha stream.
    const avif = ok
      ? await tool(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-framerate", String(PREVIEW.fps), "-i", join(work, "frame_%04d.png"),
          "-c:v", "libsvtav1", "-crf", "30", "-preset", "6", "-b:v", "0", "-loop", "0", join(dir, ENCODED_FILES.preview)])
      : null;
    if (avif?.code === 0) files.push("preview");
    else io.log("animated preview failed; going without");
  }

  // 4. Subtitles: keep one track as transcript.vtt.
  const subs = pickSubtitles(names, req.subLang);
  if (subs) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- names read from the job folder itself, matched by pickSubtitles
    await rename(join(dir, subs), join(dir, ENCODED_FILES.transcript));
    files.push("transcript");
  }

  // 5. Only what the archive takes stays.
  const keep = new Set<string>([ENCODED_FILES.info, ENCODED_FILES.poster, ENCODED_FILES.thumb, ENCODED_FILES.preview, ENCODED_FILES.transcript, "hls"]);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the job folder, validated by openJobDir
  for (const name of await readdir(dir)) if (!keep.has(name)) await rm(join(dir, name), { recursive: true, force: true });

  return {
    event: "done",
    dir: req.dir,
    files,
    probe: { duration: p.duration, width: p.video.width, height: p.video.height, vcodec: p.video.codec, acodec: p.audio?.codec ?? null, transcoded },
  };
}

if (import.meta.main) await serve("encode", EncodeRequestSchema, encode);
