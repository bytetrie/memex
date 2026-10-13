// Integration tests for jobs and the video type: the real app, repos and worker on memex_test,
// with fake runners that leave files in the harness's incoming folder the way the real ones do.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DuplicateSchema, JobListSchema, JobSchema, MAX_QUEUED_JOBS, type Job } from "../../shared/archive-jobs.ts";
import { EntryListSchema, EntrySchema, ErrorSchema } from "../../shared/archive.ts";
import { EncodeRequestSchema, FetchRequestSchema } from "../../shared/runners.ts";
import { silentLogger, useHarness } from "../testing/harness.ts";
import { sweep } from "./gc.ts";

const h = useHarness();
const A = "/api/archive";
const URL_1 = "https://video.example/watch?v=one";
const URL_2 = "https://video.example/watch?v=two";

const asJob = async (res: Response) => JobSchema.parse(await res.json());
const getJob = async (id: string) => asJob(await h.request(`${A}/jobs/${id}`));
const queue = (url: string, extra: Record<string, unknown> = {}) => h.send(`${A}/jobs`, { type: "video", input: { url }, ...extra });

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let dirCount = 0;
const VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nelephants have really long trunks\n";
const INFO = (url: string) => ({
  id: "abc123",
  title: "Me at the zoo",
  webpage_url: url,
  extractor_key: "Example",
  channel: "jawed",
  upload_date: "20050423",
  duration: 19,
  description: "The first video",
  subtitles: { en: [] },
  formats: [{ url: "https://cdn.example/secret-token" }],
  _version: { version: "2026.08.19" },
});

// A `ytdlp` that downloads into a new job folder, and an `encode` that writes what the real one does.
function fakeVideoRunners(opts: { info?: object; playlist?: string; beforeFetchDone?: Promise<void>; fail?: string } = {}) {
  h.runners.handle("ytdlp", async (raw, emit) => {
    const req = FetchRequestSchema.parse(raw);
    const dir = `job-test${String(++dirCount).padStart(4, "0")}`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(join(h.incomingDir, dir));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's temp dir
    await writeFile(join(h.incomingDir, dir, "video.mp4"), "....ftypisom fake video");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's temp dir
    await writeFile(join(h.incomingDir, dir, "video.info.json"), JSON.stringify(opts.info ?? INFO(req.url)));
    emit({ event: "log", line: "[example] abc123: Downloading webpage" });
    emit({ event: "progress", stage: "download", percent: 50, detail: "1.0 MiB of 2.0 MiB" });
    await opts.beforeFetchDone;
    if (opts.fail) {
      emit({ event: "error", message: opts.fail });
      return;
    }
    emit({ event: "done", dir, files: [{ kind: "video", name: "video.mp4" }, { kind: "info", name: "video.info.json" }] });
  });
  h.runners.handle("encode", async (raw, emit) => {
    const { dir } = EncodeRequestSchema.parse(raw);
    const d = join(h.incomingDir, dir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(join(d, "hls"));
    const files: [string, string | Uint8Array][] = [
      ["hls/index.m3u8", opts.playlist ?? '#EXTM3U\n#EXT-X-MAP:URI="media.mp4",BYTERANGE="10@0"\n#EXTINF:5.0,\n#EXT-X-BYTERANGE:20@10\nmedia.mp4\n#EXT-X-ENDLIST\n'],
      ["hls/media.mp4", "....ftypiso6 fake fragmented mp4"],
      ["poster.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])],
      ["thumb.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6])],
      ["preview.avif", "....ftypavis fake animation"],
      ["transcript.vtt", VTT],
    ];
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's temp dir
    for (const [name, content] of files) await writeFile(join(d, name), content);
    emit({ event: "progress", stage: "encode", percent: 100, detail: "Converting to HLS" });
    emit({
      event: "done",
      dir,
      files: ["playlist", "media", "info", "poster", "thumb", "preview", "transcript"],
      probe: { duration: 19.1, width: 320, height: 240, vcodec: "h264", acodec: "aac", transcoded: false },
    });
  });
}

async function runToEnd(url = URL_1): Promise<Job> {
  const res = await queue(url);
  expect(res.status).toBe(202);
  const job = await asJob(res);
  await h.worker.idle();
  return getJob(job.id);
}

describe("video entries through jobs", () => {
  it("can't be added with POST /archive/entries", async () => {
    const res = await h.send(`${A}/entries`, { type: "video", input: { url: URL_1 } });
    expect(res.status).toBe(400);
    expect(ErrorSchema.parse(await res.json()).error).toMatch(/POST \/archive\/jobs/);
  });

  it("refuses bad URLs and entry types", async () => {
    for (const url of ["http://video.example/x", "https://user:pw@video.example/x", "ftp://x", "not a url"]) {
      expect((await queue(url)).status, url).toBe(400);
    }
    expect((await h.send(`${A}/jobs`, { type: "text", input: { text: "hi" } })).status).toBe(400);
  });

  it("downloads, encodes and imports: an entry with HLS, transcript, info and images", async () => {
    fakeVideoRunners();
    const job = await runToEnd();
    expect(job).toMatchObject({ status: "done", error: null, progress: 100, ahead: null });
    expect(job.logTail).toContain("Downloading webpage");
    const entry = EntrySchema.parse(await (await h.request(`${A}/entries/${job.entryId ?? ""}`)).json());
    expect(entry).toMatchObject({ type: "video", title: "Me at the zoo", sourceUrl: URL_1 });
    expect(entry.files.map((f) => [f.name, f.role, f.mime])).toEqual([
      ["hls/index.m3u8", "original", "application/vnd.apple.mpegurl"],
      ["hls/media.mp4", "original", "video/mp4"],
      ["info.json", "metadata", "application/json"],
      ["poster.jpg", "thumbnail", "image/jpeg"],
      ["preview.avif", "thumbnail", "image/avif"],
      ["thumb.jpg", "thumbnail", "image/jpeg"],
      ["transcript.en.vtt", "derived", "text/vtt"],
    ]);
    expect(entry.meta).toEqual({
      extractor: "Example",
      videoId: "abc123",
      channel: "jawed",
      uploadDate: "2005-04-23",
      duration: 19.1,
      width: 320,
      height: 240,
      vcodec: "h264",
      acodec: "aac",
      transcoded: false,
      subtitles: "manual",
      ytDlpVersion: "2026.08.19",
    });

    // Served with their own content types.
    for (const [name, type] of [
      ["hls/index.m3u8", "application/vnd.apple.mpegurl"],
      ["hls/media.mp4", "video/mp4"],
      ["preview.avif", "image/avif"],
      ["transcript.en.vtt", "text/vtt; charset=utf-8"],
    ]) {
      expect((await h.request(`${A}/entries/${entry.id}/files/${name ?? ""}`)).headers.get("content-type"), name).toBe(type);
    }
    // The info JSON is kept without its format list (URLs with tokens) and the like.
    const info = z.record(z.string(), z.unknown()).parse(await (await h.request(`${A}/entries/${entry.id}/files/info.json`)).json());
    expect(info).toMatchObject({ id: "abc123", title: "Me at the zoo" });
    expect(info).not.toHaveProperty("formats");

    // The transcript is searchable, and cards get the thumbnails.
    const found = EntryListSchema.parse(await (await h.request(`${A}/entries?q=trunks`)).json());
    expect(found.items.map((e) => e.id)).toEqual([entry.id]);
    expect(found.items[0]?.thumbnails.map((t) => t.name)).toEqual(["poster.jpg", "preview.avif", "thumb.jpg"]);

    // The runners' job folder is gone.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect(await readdir(h.incomingDir)).toEqual([]);
  });

  it("uses the title and tags given with the job", async () => {
    fakeVideoRunners();
    const res = await queue(URL_1, { title: "Zoo", tags: ["Animals"] });
    const job = await asJob(res);
    expect(job).toMatchObject({ title: "Zoo", tags: ["animals"] });
    await h.worker.idle();
    const done = await getJob(job.id);
    const entry = EntrySchema.parse(await (await h.request(`${A}/entries/${done.entryId ?? ""}`)).json());
    expect(entry).toMatchObject({ title: "Zoo", tags: ["animals"] });
  });

  it("records a runner's error with the log tail, and leaves nothing behind", async () => {
    fakeVideoRunners({ fail: "ERROR: [example] abc123: Video unavailable" });
    const job = await runToEnd();
    expect(job).toMatchObject({ status: "failed", error: "ERROR: [example] abc123: Video unavailable", entryId: null });
    expect(job.logTail).toContain("Downloading webpage");
    expect(EntryListSchema.parse(await (await h.request(`${A}/entries`)).json()).items).toEqual([]);
  });

  it("fails when the runner is not available", async () => {
    const job = await runToEnd();
    expect(job).toMatchObject({ status: "failed", error: "runner ytdlp is not available" });
  });

  it("refuses a playlist that points anywhere but its media file, and cleans up", async () => {
    fakeVideoRunners({ playlist: "#EXTM3U\n#EXTINF:5.0,\nhttps://evil.example/x.ts\n#EXT-X-ENDLIST\n" });
    const job = await runToEnd();
    expect(job).toMatchObject({ status: "failed", error: "the HLS playlist is not what the encode runner should write" });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect(await readdir(h.incomingDir)).toEqual([]);
    const gc = await sweep({ ...h.archive, log: silentLogger }, -1000);
    expect(gc.blobs).toEqual([]); // nothing was imported, or it was removed at once
  });

  it("refuses duplicates: queued (jobId) and archived (entryId), also by the page's own URL", async () => {
    const gate = deferred();
    fakeVideoRunners({ beforeFetchDone: gate.promise });
    const first = await asJob(await queue(URL_1));
    const again = await queue(URL_1);
    expect(again.status).toBe(409);
    expect(DuplicateSchema.parse(await again.json())).toMatchObject({ jobId: first.id });
    gate.release();
    await h.worker.idle();
    const done = await getJob(first.id);
    const archived = await queue(URL_1);
    expect(DuplicateSchema.parse(await archived.json())).toMatchObject({ entryId: done.entryId });

    // A short link to the same video: found out after the download (webpage_url).
    fakeVideoRunners({ info: INFO(URL_1) });
    const short = await runToEnd("https://vid.example/one");
    expect(short.status).toBe("failed");
    expect(short.error).toBe(`this video is already archived: archive:${done.entryId ?? ""}`);
  });

  it("runs jobs one at a time, in order, and says how many are ahead", async () => {
    const gate = deferred();
    fakeVideoRunners({ beforeFetchDone: gate.promise });
    const a = await asJob(await queue(URL_1));
    const b = await asJob(await queue(URL_2));
    expect((await getJob(a.id)).status).toBe("running");
    expect(await getJob(b.id)).toMatchObject({ status: "queued", ahead: 1 });
    const listed = JobListSchema.parse(await (await h.request(`${A}/jobs`)).json());
    expect(listed.items.map((j) => j.id)).toEqual([b.id, a.id]);
    gate.release();
    await h.worker.idle();
    const [doneA, doneB] = [await getJob(a.id), await getJob(b.id)];
    expect([doneA.status, doneB.status]).toEqual(["done", "done"]);
    expect(Date.parse(doneB.startedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(doneA.finishedAt ?? ""));
    // Finished jobs leave the default list once they are done.
    expect(JobListSchema.parse(await (await h.request(`${A}/jobs`)).json()).items).toEqual([]);
    expect(JobListSchema.parse(await (await h.request(`${A}/jobs?status=done`)).json()).items).toHaveLength(2);
  });

  it("cancels queued and running jobs, retries them, and dismisses finished ones", async () => {
    // The download waits until it is cancelled, like a long one.
    h.runners.handle("ytdlp", (_req, _emit, signal) => new Promise((resolve) => { signal.addEventListener("abort", () => { resolve(); }); }));
    const a = await asJob(await queue(URL_1));
    const b = await asJob(await queue(URL_2));

    expect(await asJob(await h.request(`${A}/jobs/${b.id}/cancel`, { method: "POST" }))).toMatchObject({ status: "cancelled" });
    expect((await h.request(`${A}/jobs/${a.id}`, { method: "DELETE" })).status).toBe(409); // still running
    expect((await h.request(`${A}/jobs/${a.id}/cancel`, { method: "POST" })).status).toBe(200);
    await h.worker.idle();
    expect(await getJob(a.id)).toMatchObject({ status: "cancelled", error: "cancelled" });
    expect((await h.request(`${A}/jobs/${a.id}/cancel`, { method: "POST" })).status).toBe(409);

    fakeVideoRunners();
    expect(await asJob(await h.request(`${A}/jobs/${b.id}/retry`, { method: "POST" }))).toMatchObject({ status: "queued", error: null });
    await h.worker.idle();
    expect((await getJob(b.id)).status).toBe("done");
    expect((await h.request(`${A}/jobs/${b.id}/retry`, { method: "POST" })).status).toBe(409);

    expect((await h.request(`${A}/jobs/${b.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await h.request(`${A}/jobs/${b.id}`)).status).toBe(404);
  });

  it(`refuses more than ${String(MAX_QUEUED_JOBS)} waiting jobs (429)`, async () => {
    for (let i = 0; i < MAX_QUEUED_JOBS; i++) {
      await h.archive.jobs.createJob({ type: "video", input: { url: `${URL_1}&n=${String(i)}` }, sourceUrl: `${URL_1}&n=${String(i)}` });
    }
    expect((await queue(URL_2)).status).toBe(429);
  });

  it("after a restart, marks the running job failed and clears the incoming folder", async () => {
    const job = await h.archive.jobs.createJob({ type: "video", input: { url: URL_1 }, sourceUrl: URL_1 });
    await h.archive.jobs.claimNext();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(join(h.incomingDir, "job-leftover"));
    h.worker.stop(); // don't run anything; start() only recovers here
    await h.worker.start();
    expect(await getJob(job.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/restarted/) as unknown });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect(await readdir(h.incomingDir)).toEqual([]);
  });
});
