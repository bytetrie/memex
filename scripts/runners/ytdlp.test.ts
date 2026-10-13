import { describe, expect, it } from "vitest";
import { FetchRequestSchema } from "../../src/shared/runners.ts";
import { classify, createProgressReader, errorMessage, formatSelector, subtitleArgs, ytDlpArgs } from "./ytdlp.ts";

describe("ytdlp runner", () => {
  const req = FetchRequestSchema.parse({ v: 1, op: "fetch", url: "https://www.youtube.com/watch?v=abc", maxHeight: 1080, subLang: "en" });

  it("prefers H.264 + AAC under the height cap and lets unknown heights through", () => {
    expect(formatSelector(1080)).toBe("bv*[height<=?1080][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=?1080]+ba/b[height<=?1080]");
  });

  it("passes the URL last, after --, so it can't be read as an option", () => {
    const args = ytDlpArgs({ ...req, url: "https://x.test/--exec=rm" }, "/in/job-abcdef", "/in/job-abcdef/.work");
    expect(args.slice(-2)).toEqual(["--", "https://x.test/--exec=rm"]);
    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-playlist");
    expect(args).not.toContain("--write-subs"); // subtitles are a separate, optional step
  });

  it("fetches subtitles from the saved info JSON, without machine translations", () => {
    const args = subtitleArgs(req, "/in/job-abcdef", "/in/job-abcdef/.work");
    expect(args).toEqual(expect.arrayContaining(["--skip-download", "--load-info-json", "/in/job-abcdef/video.info.json", "--write-auto-subs"]));
    expect(args).not.toContain(req.url);
    // yt-dlp matches each pattern against the whole name, ignoring case.
    // eslint-disable-next-line security/detect-non-literal-regexp -- the runner's own fixed patterns
    const patterns = (args[args.indexOf("--sub-langs") + 1] ?? "").split(",").map((p) => new RegExp(`^(?:${p})$`, "i"));
    const wanted = (lang: string) => patterns.some((p) => p.test(lang));
    expect(["en", "en-US", "en-GB", "en-orig"].filter(wanted)).toEqual(["en", "en-US", "en-GB", "en-orig"]);
    expect(["en-en-US", "en-de", "en-fr", "en-hi", "en-id", "en-ja", "de", "en-orig-x"].filter(wanted)).toEqual([]);
  });

  it("refuses requests that are not https or carry credentials", () => {
    for (const url of ["http://x.test/v", "file:///etc/passwd", "https://u:p@x.test/v", "--exec=rm", "https://"]) {
      expect(FetchRequestSchema.safeParse({ ...req, url }).success, url).toBe(false);
    }
  });

  it("says which part a progress line belongs to: video, then audio, then the merge", () => {
    const read = createProgressReader();
    expect(read("[info] VMj-3S1tku0: Downloading 1 format(s): 137+140")).toBeNull();
    expect(read("@@progress downloading 524288 1048576 262144 2 137 avc1.640028 none")).toEqual({
      percent: 50,
      detail: "Video (1 of 2): 512.0 KiB of 1.0 MiB, 256.0 KiB/s, ETA 0:02",
    });
    expect(read("@@progress downloading 14680064 141662208 84172 1507 140 none mp4a.40.2")).toEqual({
      percent: 10.4,
      detail: "Audio (2 of 2): 14.0 MiB of 135.1 MiB, 82.2 KiB/s, ETA 25:07",
    });
    expect(read('[Merger] Merging formats into "/in/job-x/video.mp4"')).toEqual({ percent: null, detail: "Merging video and audio" });
    expect(read("[youtube] abc: Downloading webpage")).toBeNull();
  });

  it("reads a single download without parts, and unknown sizes", () => {
    const read = createProgressReader();
    expect(read("@@progress downloading 1000 NA NA NA mp4 avc1 mp4a")).toEqual({ percent: null, detail: "Video and audio: 1000 B" });
    expect(read("@@progress finished 2000 2000 NA NA NA NA NA")).toEqual({ percent: 100, detail: "Download: 2.0 KiB of 2.0 KiB" });
  });

  it("classifies what yt-dlp left and ignores the rest", () => {
    expect(classify(["video.mp4", "video.info.json", "video.jpg", "video.en.vtt", "video.en-orig.vtt", "video.webp", "video.mp4.part", "evil.sh"])).toEqual([
      { kind: "video", name: "video.mp4" },
      { kind: "info", name: "video.info.json" },
      { kind: "thumbnail", name: "video.jpg" },
      { kind: "subtitles", name: "video.en.vtt" },
      { kind: "subtitles", name: "video.en-orig.vtt" },
    ]);
  });

  it("reports yt-dlp's own error line", () => {
    expect(errorMessage(["WARNING: x", "ERROR: [youtube] abc: Video unavailable", "more"], 1)).toBe("ERROR: [youtube] abc: Video unavailable");
    expect(errorMessage(["noise"], 2)).toBe("yt-dlp exited with code 2");
  });
});
