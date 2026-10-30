// Renders every route server-side and fails if the markup contains a <style>
// tag: the CSP (style-src 'self', no 'unsafe-inline') would block it in the
// browser, silently breaking layout. Catches Mantine components that inject
// runtime styles (AppShell, Grid, SimpleGrid, responsive style props...).
// API calls made by route loaders go to the real Hono app, in-process.
// usage: pnpm check:csp

import { createServer } from "vite";
import { z } from "zod";
import { createApp } from "../src/server/app.ts";
import { idleWorker, stubBlobs, stubIncoming, stubJobs, stubMemexRepo, stubNotesRepo, stubRepo } from "../src/server/testing/stubs.ts";
import type { Job } from "../src/shared/archive-jobs.ts";
import type { Entry } from "../src/shared/archive.ts";
import type { MemexPage } from "../src/shared/memex.ts";
import type { Page } from "../src/shared/notes.ts";

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
// A notes page with every kind of node (the editor itself is a lazy chunk, so the server render
// shows its fallback; the browser checks run in e2e/notes.spec.ts).
const PAGE_ID = "019a0000-0000-7000-8000-000000000004";
const page: Page = {
  id: PAGE_ID,
  title: "Fixture page",
  tags: ["fixture"],
  version: 3,
  createdAt: now,
  updatedAt: now,
  linkTitles: { [PAGE_ID]: "Fixture page" },
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { id: "h", level: 1 }, content: [{ type: "text", text: "Heading" }] },
      { type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "See " }, { type: "pageLink", attrs: { pageId: PAGE_ID, label: "Fixture page" } }] },
      { type: "archiveEmbed", attrs: { id: "e", entryId: FIXTURE_ID } },
      { type: "drawing", attrs: { id: "d", drawingId: "019a0000-0000-7000-8000-000000000005" } },
    ],
  },
};
const notes = {
  repo: stubNotesRepo({
    listPages: () => Promise.resolve({ items: [{ id: PAGE_ID, title: page.title, tags: page.tags, snippet: "Heading", updatedAt: now }], nextCursor: null }),
    tagCounts: () => Promise.resolve([{ tag: "fixture", count: 1 }]),
    getPage: (id: string) => Promise.resolve(id === PAGE_ID ? page : null),
    backlinks: () => Promise.resolve([{ pageId: PAGE_ID, pageTitle: page.title, blockId: "p", text: "See", targetBlockId: null }]),
  }),
};
// A memex page with every element kind and both effects, for the editor and the print view.
const MEMEX_ID = "019a0000-0000-7000-8000-000000000006";
const box = { x: 36, y: 36, w: 120, h: 80, rotation: 0, opacity: 1, hidden: false, locked: false, effects: [] };
const memexPage: MemexPage = {
  id: MEMEX_ID,
  title: "Fixture sheet",
  tags: ["fixture"],
  version: 2,
  createdAt: now,
  updatedAt: now,
  doc: {
    format: { size: "half", orientation: "portrait", margin: 36 },
    grid: { step: 9, show: true, snap: true },
    elements: [
      { ...box, id: "t", kind: "text", font: "serif", fontSize: 14, lineHeight: 1.2, align: "left", color: "#000000", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }, { type: "size", attrs: { pt: 24 } }] }] }] } },
      { ...box, id: "i", kind: "image", asset: "c".repeat(64), fit: "contain", effects: [{ type: "grayscale" }] },
      { ...box, id: "s", kind: "svg", asset: "d".repeat(64), fit: "contain", effects: [{ type: "halftone", cell: 6, angle: 45, shape: "circle", invert: false }] },
      { ...box, id: "x", kind: "excalidraw", asset: "e".repeat(64), scene: "f".repeat(64), fit: "contain", rotation: 10, opacity: 0.5 },
      { ...box, id: "q", kind: "qr", text: "https://app.memex", ecc: "M", color: "#000000", quiet: true },
      { ...box, id: "f", kind: "frame" },
    ],
  },
};
const memex = {
  repo: stubMemexRepo({
    listPages: () => Promise.resolve({ items: [{ id: MEMEX_ID, title: memexPage.title, tags: memexPage.tags, format: memexPage.doc.format, snippet: "Hello", updatedAt: now }], nextCursor: null }),
    tagCounts: () => Promise.resolve([{ tag: "fixture", count: 1 }]),
    getPage: (id: string) => Promise.resolve(id === MEMEX_ID ? memexPage : null),
  }),
  blobs: stubBlobs(),
};
const app = createApp({ tokenOk: () => true, dbReachable: () => Promise.resolve(null), log, archive, notes, memex });
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
  for (const path of [...mod.paths, "/archive/new/file", "/archive/new/text", "/archive/new/video", `/archive/e/${FIXTURE_ID}`, `/archive/e/${VIDEO_ID}`, `/notes/p/${PAGE_ID}`, `/memex/p/${MEMEX_ID}`, `/memex/print?pages=${MEMEX_ID}&layout=copies`, `/memex/print?pages=${MEMEX_ID}&view=web`]) {
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
