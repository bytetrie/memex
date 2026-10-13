// Renders every route server-side and fails if the markup contains a <style>
// tag: the CSP (style-src 'self', no 'unsafe-inline') would block it in the
// browser, silently breaking layout. Catches Mantine components that inject
// runtime styles (AppShell, Grid, SimpleGrid, responsive style props...).
// API calls made by route loaders go to the real Hono app, in-process.
// usage: pnpm check:csp

import { createServer } from "vite";
import { z } from "zod";
import { createApp } from "../src/server/app.ts";
import { idleWorker, stubBlobs, stubIncoming, stubJobs, stubRepo } from "../src/server/testing/stubs.ts";
import type { Job } from "../src/shared/archive-jobs.ts";
import type { Entry } from "../src/shared/archive.ts";

// The archive routes render a fixture entry served from memory, so no database
// or disk is needed. Every repo method the pages don't call fails loudly.
const FIXTURE_ID = "019a0000-0000-7000-8000-000000000001";
const now = new Date().toISOString();
const fixture: Entry = {
  id: FIXTURE_ID,
  type: "text",
  title: "Fixture entry",
  sourceUrl: null,
  tags: ["fixture"],
  fileCount: 1,
  thumbnails: [],
  createdAt: now,
  meta: { example: true },
  files: [{ name: "content.md", role: "original", mime: "text/markdown", sha256: "a".repeat(64), size: 13, createdAt: now }],
  refs: [{ module: "notes", itemId: "n1", createdAt: now }],
};
// A video entry (player, transcript, card thumbnails) and a failed job, so those pages render too.
const VIDEO_ID = "019a0000-0000-7000-8000-000000000002";
const sha = "b".repeat(64);
const videoFile = (name: string, role: "original" | "derived" | "metadata" | "thumbnail", mime: string) => ({ name, role, mime, sha256: sha, size: 10, createdAt: now });
const video: Entry = {
  id: VIDEO_ID,
  type: "video",
  title: "Fixture video",
  sourceUrl: "https://video.example/watch?v=1",
  tags: [],
  fileCount: 4,
  thumbnails: [{ name: "thumb.jpg", mime: "image/jpeg" }, { name: "preview.avif", mime: "image/avif" }],
  createdAt: now,
  meta: { channel: "Someone", duration: 75, width: 1280, height: 720, subtitles: "manual" },
  files: [
    videoFile("hls/index.m3u8", "original", "application/vnd.apple.mpegurl"),
    videoFile("hls/media.mp4", "original", "video/mp4"),
    videoFile("thumb.jpg", "thumbnail", "image/jpeg"),
    videoFile("transcript.en.vtt", "derived", "text/vtt"),
  ],
  refs: [],
};
const failedJob: Job = {
  id: "019a0000-0000-7000-8000-000000000003",
  type: "video",
  input: { url: "https://video.example/watch?v=2" },
  title: null,
  tags: [],
  status: "failed",
  ahead: null,
  stage: "download",
  progress: null,
  detail: null,
  error: "ERROR: Video unavailable",
  logTail: "[example] 2: Downloading webpage",
  entryId: null,
  createdAt: now,
  startedAt: now,
  finishedAt: now,
};
const repo = stubRepo({
  listEntries: () => Promise.resolve({ items: [fixture, video], nextCursor: null }),
  recentSearches: () => Promise.resolve({ items: [{ query: "fixture", type: null, lastAt: now }] }),
  getEntry: (id: string) => Promise.resolve(id === FIXTURE_ID ? fixture : id === VIDEO_ID ? video : null),
  getFile: (id: string, name: string) => {
    if (id === FIXTURE_ID && name === "content.md") return Promise.resolve({ sha256: "a".repeat(64), size: 13, mime: "text/markdown", role: "original" as const });
    const file = id === VIDEO_ID ? video.files.find((f) => f.name === name) : undefined;
    return Promise.resolve(file ? { sha256: file.sha256, size: 13, mime: file.mime, role: file.role } : null);
  },
});
const blobs = stubBlobs({ get: () => Promise.resolve(new Blob(["Fixture text\n"]).stream()) });
const log = { info() {}, warn() {}, error() {}, child: () => log };

const jobs = stubJobs({ listJobs: () => Promise.resolve([failedJob]) });
const archive = { repo, blobs, jobs, worker: idleWorker, incoming: stubIncoming() };
const app = createApp({ tokenOk: () => true, dbReachable: () => Promise.resolve(null), log, archive });
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  return Promise.resolve(app.fetch(new Request(new URL(url, "http://localhost"), init)));
};

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let failed = 0;
try {
  const mod = z
    .object({
      paths: z.array(z.string()),
      render: z.custom<(path: string) => Promise<string>>((v) => typeof v === "function", "render must be a function"),
    })
    .parse(await vite.ssrLoadModule("/src/csp-check.tsx"));
  for (const path of [...mod.paths, "/archive/new/file", "/archive/new/text", "/archive/new/video", `/archive/e/${FIXTURE_ID}`, `/archive/e/${VIDEO_ID}`]) {
    const html = await mod.render(path);
    const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
    const firstStyle = styles[0];
    if (html.includes("Something went wrong")) {
      failed++;
      console.error(`FAIL ${path}: route rendered its error component: ${html.slice(html.indexOf("Something went wrong"), html.indexOf("Something went wrong") + 400).replace(/<[^>]*>/g, " ")}`);
    } else if (firstStyle !== undefined) {
      failed++;
      console.error(`FAIL ${path}: ${String(styles.length)} <style> tag(s), e.g. ${firstStyle.slice(0, 200)}`);
    } else {
      console.log(`ok   ${path}`);
    }
  }
} finally {
  await vite.close();
  globalThis.fetch = realFetch;
}
process.exit(failed ? 1 : 0);
