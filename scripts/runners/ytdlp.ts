// Runner `ytdlp`: downloads one video with the pinned yt-dlp (scripts/yt-dlp.ts) into a new job
// folder in $INCOMING_DIR: the video merged with its audio, yt-dlp's info JSON, the site's thumbnail
// as JPEG and subtitles in the requested language. Protocol: src/shared/runners.ts (op "fetch").
// Declared on the host as `node scripts/runners/ytdlp.ts`; it has the internet, nothing else.

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FetchRequestSchema, type FetchRequest, type FetchDone } from "../../src/shared/runners.ts";
import { makeJobDir, makeSubdir, removeJobDir, runTool, serve, toolEnv, type JobIo } from "./lib.ts";

// The pinned bundled build (scripts/yt-dlp.ts): its own Python and curl_cffi, so no python3 needed.
const YT_DLP = join(import.meta.dirname, "../../vendor/yt-dlp/current/yt-dlp_linux");
const MARK = "@@progress ";
const NA = "NA";

// Prefer H.264 + AAC (HLS is then a plain remux), never above maxHeight. "<=?" lets a format whose
// height the site doesn't report through (a plain .mp4 link).
export function formatSelector(maxHeight: number): string {
  const h = `[height<=?${String(maxHeight)}]`;
  return `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}+ba/b${h}`;
}

// Options both steps share: no config files or cache, plain line output, files into the job folder.
function commonArgs(dir: string, work: string): string[] {
  return [
    "--ignore-config",
    "--no-cache-dir",
    "--color", "never",
    "--newline",
    "--socket-timeout", "30",
    "--retries", "5",
    "--no-mtime",
    "--js-runtimes", "node",
    "--paths", `home:${dir}`,
    "--paths", `temp:${work}`,
    "-o", "video.%(ext)s",
  ];
}

// Step 1: the video (merged with its audio), the info JSON and the thumbnail. Failing here fails the job.
export function ytDlpArgs(req: FetchRequest, dir: string, work: string): string[] {
  return [
    ...commonArgs(dir, work),
    "--no-playlist",
    "--progress-template",
    `download:${MARK}%(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.format_id)s %(info.vcodec)s %(info.acodec)s`,
    "--match-filters", "!is_live & live_status!=?is_upcoming", // "?": a field the site doesn't report passes
    "-f", formatSelector(req.maxHeight),
    "--merge-output-format", "mp4/mkv",
    "--write-info-json",
    "--write-thumbnail", "--convert-thumbnails", "jpg",
    "--max-filesize", "4G",
    "--",
    req.url,
  ];
}

// The subtitle tracks to ask for: the language itself, YouTube's original-language automatic track
// ("en-orig") and, for English, the regional tracks by name. Not machine translations into the
// language ("en-de", "en-hi": English translated from German, Hindi), of which a video can have
// dozens; fetching them all in a row got the request refused (HTTP 429). yt-dlp matches these
// patterns case-insensitively, so "en-[A-Z][A-Z]" would take the translations too: hence the list.
const ENGLISH_REGIONS = ["US", "GB", "CA", "AU", "IE", "NZ", "IN"];
export const subtitleLangs = (lang: string) =>
  [lang, ...(lang === "en" ? ENGLISH_REGIONS.map((r) => `en-${r}`) : []), `${lang}-orig`].join(",");

// Step 2: subtitles, from the info JSON step 1 saved (no second visit to the page). Optional: if
// it fails, the video is archived without a transcript.
export function subtitleArgs(req: FetchRequest, dir: string, work: string): string[] {
  return [
    ...commonArgs(dir, work),
    "--skip-download",
    "--load-info-json", `${dir}/video.info.json`,
    "--write-subs", "--write-auto-subs",
    "--sub-langs", subtitleLangs(req.subLang),
    "--sub-format", "vtt/best", "--convert-subs", "vtt",
    "--sleep-subtitles", "2",
  ];
}

const num = (s: string | undefined) => (s === undefined || s === NA || s === "" ? null : Number(s));

function formatBytes(n: number): string {
  if (n < 1024) return `${String(Math.round(n))} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

// "1507" seconds -> "25:07", "3725" -> "1:02:05"
function formatEta(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${sec}` : `${String(m)}:${sec}`;
}

// yt-dlp downloads the video and the audio stream one after the other (format "137+140"), each
// with its own progress from 0 to 100 %, then merges them. The reader keeps track of which part is
// running, so the detail says "Video (1 of 2)" / "Audio (2 of 2)" instead of a bar that seems to
// start over. Returns progress for --progress-template lines and the merge step, null otherwise.
export function createProgressReader(): (line: string) => { percent: number | null; detail: string } | null {
  let formats: string[] = [];
  return (line) => {
    // "[info] VMj-3S1tku0: Downloading 1 format(s): 137+140"
    const chosen = /^\[info\] .*Downloading \d+ format\(s\): (\S+)$/.exec(line);
    if (chosen?.[1]) {
      formats = chosen[1].split("+");
      return null;
    }
    if (line.startsWith("[Merger]")) return { percent: null, detail: "Merging video and audio" };
    if (!line.startsWith(MARK)) return null;

    const [status, done, total, speed, eta, formatId, vcodec, acodec] = line.slice(MARK.length).trim().split(/\s+/);
    const d = num(done);
    const t = num(total);
    const percent = d !== null && t !== null && t > 0 && Number.isFinite(d / t) ? Math.min(100, (d / t) * 100) : null;
    const parts: string[] = [];
    if (d !== null && Number.isFinite(d)) parts.push(t !== null && Number.isFinite(t) ? `${formatBytes(d)} of ${formatBytes(t)}` : formatBytes(d));
    const sp = num(speed);
    if (sp !== null && Number.isFinite(sp)) parts.push(`${formatBytes(sp)}/s`);
    const e = num(eta);
    if (status === "downloading" && e !== null && Number.isFinite(e)) parts.push(`ETA ${formatEta(e)}`);

    const what = vcodec === "none" ? "Audio" : acodec === "none" ? "Video" : vcodec === undefined || vcodec === NA ? "Download" : "Video and audio";
    const index = formatId === undefined ? -1 : formats.indexOf(formatId);
    const label = formats.length > 1 && index >= 0 ? `${what} (${String(index + 1)} of ${String(formats.length)})` : what;
    return { percent: percent === null ? null : Math.round(percent * 10) / 10, detail: `${label}: ${parts.join(", ")}` };
  };
}

// The files yt-dlp left, by kind. Everything else (an unconverted .webp thumbnail, a .part) is
// left out and removed.
export function classify(names: string[]): FetchDone["files"] {
  const files: FetchDone["files"] = [];
  for (const name of names) {
    if (/^video\.(mp4|mkv|webm)$/.test(name)) files.push({ kind: "video", name });
    else if (name === "video.info.json") files.push({ kind: "info", name });
    else if (name === "video.jpg") files.push({ kind: "thumbnail", name });
    else if (/^video\.[A-Za-z0-9_-]{1,20}\.vtt$/.test(name)) files.push({ kind: "subtitles", name });
  }
  return files;
}

// The last "ERROR:" line yt-dlp printed, which says what went wrong ("Video unavailable", ...).
export function errorMessage(stderr: string[], code: number | null): string {
  const line = stderr.findLast((l) => l.startsWith("ERROR:"));
  return line ?? `yt-dlp exited with ${code === null ? "a signal" : `code ${String(code)}`}`;
}

// A function, so TypeScript doesn't narrow `aborted` to false after the first check.
const cancelled = (io: JobIo) => io.signal.aborted;

async function fetchVideo(req: FetchRequest, io: JobIo): Promise<FetchDone> {
  const job = await makeJobDir();
  const work = join(job.path, ".work");
  try {
    await makeSubdir(work);
    io.progress({ stage: "download", percent: null, detail: "Starting" });
    const readProgress = createProgressReader();
    const result = await runTool(YT_DLP, ytDlpArgs(req, job.path, work), {
      cwd: work,
      env: toolEnv(work),
      signal: io.signal,
      onStdout: (line) => {
        const p = readProgress(line);
        if (p) io.progress({ stage: "download", ...p });
        if (line.trim() && !line.startsWith(MARK)) io.log(line);
      },
      onStderr: (line) => {
        if (line.trim()) io.log(line);
      },
    });
    if (cancelled(io)) throw new Error("cancelled");
    if (result.code !== 0) throw new Error(errorMessage(result.stderrTail, result.code));

    io.progress({ stage: "download", percent: null, detail: "Fetching subtitles" });
    const subs = await runTool(YT_DLP, subtitleArgs(req, job.path, work), {
      cwd: work,
      env: toolEnv(work),
      signal: io.signal,
      onStdout: (line) => {
        if (line.trim() && !line.startsWith(MARK)) io.log(line);
      },
      onStderr: (line) => {
        if (line.trim()) io.log(line);
      },
    });
    if (cancelled(io)) throw new Error("cancelled");
    if (subs.code !== 0) io.log(`Subtitles skipped, the video is kept without a transcript: ${errorMessage(subs.stderrTail, subs.code)}`);

    await rm(work, { recursive: true, force: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the job folder makeJobDir just made
    const entries = await readdir(job.path, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile()).map((e) => e.name);
    const files = classify(names);
    for (const extra of entries.filter((e) => !files.some((f) => f.name === e.name))) {
      await rm(join(job.path, extra.name), { recursive: true, force: true });
    }
    if (!files.some((f) => f.kind === "video")) throw new Error("yt-dlp downloaded no video (a live stream, a playlist page or a filtered format?)");
    if (!files.some((f) => f.kind === "info")) throw new Error("yt-dlp wrote no info JSON");
    return { event: "done", dir: job.name, files };
  } catch (err) {
    await removeJobDir(job.path);
    throw err;
  }
}

if (import.meta.main) await serve("ytdlp", FetchRequestSchema, fetchVideo);
