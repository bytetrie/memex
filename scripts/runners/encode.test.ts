// The encode runner's pure parts, and the runner itself on a clip ffmpeg generates (no network).

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/server/node/child-process.ts";
import { EncodeEventSchema } from "../../src/shared/runners.ts";
import { frameTimes, hlsArgs, pickSubtitles, plan, progressPercent } from "./encode.ts";

const probe = (streams: object[], duration = "10.5") => JSON.stringify({ streams, format: { duration } });

describe("encode runner: decisions", () => {
  it("remuxes H.264/VP9/AV1 with AAC/Opus and re-encodes anything else", () => {
    const p = plan(probe([{ index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { index: 1, codec_type: "audio", codec_name: "aac" }]));
    expect(p).toEqual({ video: { index: 0, codec: "h264", width: 1920, height: 1080, copy: true }, audio: { index: 1, codec: "aac", copy: true }, duration: 10.5 });
    const q = plan(probe([{ index: 0, codec_type: "video", codec_name: "mpeg4", width: 640, height: 480 }, { index: 1, codec_type: "audio", codec_name: "mp3" }]));
    expect([q.video.copy, q.audio?.copy]).toEqual([false, false]);
    expect(hlsArgs("in.mkv", q, "/o")).toEqual(expect.arrayContaining(["libx264", "aac"]));
    expect(hlsArgs("in.mp4", p, "/o")).not.toContain("libx264");
  });

  it("skips cover art, allows silent videos and refuses audio-only files", () => {
    const p = plan(probe([{ index: 0, codec_type: "video", codec_name: "mjpeg", width: 300, height: 300, disposition: { attached_pic: 1 } }, { index: 1, codec_type: "video", codec_name: "vp9", width: 640, height: 360 }]));
    expect(p.video.index).toBe(1);
    expect(p.audio).toBeNull();
    expect(hlsArgs("in.webm", p, "/o").filter((a) => a === "-map")).toHaveLength(1);
    expect(() => plan(probe([{ index: 0, codec_type: "audio", codec_name: "aac" }]))).toThrow(/no video stream/);
  });

  it("spreads preview frames over 5-95 % of the video", () => {
    const times = frameTimes(100, 12);
    expect(times).toHaveLength(12);
    expect(times[0]).toBeCloseTo(5);
    expect(times.at(-1)).toBeCloseTo(95);
  });

  it("picks the subtitle track: exact language, then a regional one, then the original-language one", () => {
    expect(pickSubtitles(["video.en-orig.vtt", "video.en-US.vtt", "video.en.vtt"], "en")).toBe("video.en.vtt");
    expect(pickSubtitles(["video.en-orig.vtt", "video.en-US.vtt"], "en")).toBe("video.en-US.vtt");
    expect(pickSubtitles(["video.en-orig.vtt", "video.de.vtt"], "en")).toBe("video.en-orig.vtt");
    expect(pickSubtitles(["video.de.vtt", "video.mp4"], "en")).toBeNull();
  });

  it("turns ffmpeg progress into a percentage", () => {
    expect(progressPercent("out_time_us=5000000", 10)).toBe(50);
    expect(progressPercent("out_time_us=5000000", null)).toBeNull();
    expect(progressPercent("frame=12", 10)).toBeNull();
  });
});

describe("encode runner: a real run", () => {
  let incoming = "";
  const job = "job-test01";
  beforeAll(async () => {
    incoming = await mkdtemp(join(tmpdir(), "encode-test-"));
    const dir = join(incoming, job);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(dir);
    const clip = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", join(dir, "video.mp4")]);
    expect(clip.code, clip.stderr).toBe(0);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await writeFile(join(dir, "video.info.json"), JSON.stringify({ id: "x", title: "Test clip" }));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await writeFile(join(dir, "video.en.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\n");
  });
  afterAll(() => rm(incoming, { recursive: true, force: true }));

  it("leaves HLS, images and the transcript, and removes the download", async () => {
    const res = await run("node", [join(import.meta.dirname, "encode.ts")], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", INCOMING_DIR: incoming },
      input: `${JSON.stringify({ v: 1, op: "encode", dir: job, subLang: "en" })}\n`,
    });
    const events = res.stdout.trim().split("\n").map((line) => EncodeEventSchema.parse(JSON.parse(line)));
    const done = events.at(-1);
    expect(done?.event, res.stderr).toBe("done");
    if (done?.event !== "done") return;
    expect(done.files.sort()).toEqual(["info", "media", "playlist", "poster", "preview", "thumb", "transcript"]);
    expect(done.probe).toMatchObject({ width: 640, height: 360, vcodec: "h264", acodec: "aac", transcoded: false });

    const dir = join(incoming, job);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect((await readdir(dir)).sort()).toEqual(["hls", "poster.jpg", "preview.avif", "thumb.jpg", "transcript.vtt", "video.info.json"]);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    const playlist = await readFile(join(dir, "hls/index.m3u8"), "utf8");
    expect(playlist).toContain('#EXT-X-MAP:URI="media.mp4",BYTERANGE=');
    expect(playlist).toContain("#EXT-X-ENDLIST");
    // An animated AVIF: the "avis" brand, a still image (stream 0) and the animation (stream 1)
    // with one frame per preview frame.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    const avif = await readFile(join(dir, "preview.avif"));
    expect(avif.subarray(8, 12).toString("latin1")).toBe("avis");
    const frames = await run("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", join(dir, "preview.avif")]);
    expect(frames.stdout.trim().split("\n")).toEqual(["1", "12"]);
  }, 60_000);

  it("refuses a job folder outside INCOMING_DIR", async () => {
    const res = await run("node", [join(import.meta.dirname, "encode.ts")], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", INCOMING_DIR: incoming },
      input: `${JSON.stringify({ v: 1, op: "encode", dir: "../etc", subLang: "en" })}\n`,
    });
    expect(res.stdout).toContain('"event":"error"');
    expect(res.code).toBe(1);
  });
});
