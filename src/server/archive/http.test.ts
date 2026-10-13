import { describe, expect, it } from "vitest";
import { ArchiveError } from "./ports.ts";
import { contentDisposition, limitBytes, parseRange, servedContentType } from "./http.ts";

describe("parseRange", () => {
  it("parses closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  it("clamps the end and an oversized suffix", () => {
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("flags ranges outside the file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
  it("ignores headers it does not understand", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("bytes=9-3", 100)).toBeNull();
  });
});

describe("serving untrusted files", () => {
  it("serves media and data types as themselves, everything else as plain text", () => {
    expect(servedContentType("video/mp4")).toBe("video/mp4");
    expect(servedContentType("application/vnd.apple.mpegurl")).toBe("application/vnd.apple.mpegurl");
    expect(servedContentType("image/avif")).toBe("image/avif");
    expect(servedContentType("text/vtt")).toBe("text/vtt; charset=utf-8");
    expect(servedContentType("Application/JSON")).toBe("application/json; charset=utf-8");
    for (const mime of ["text/html", "image/svg+xml", "text/javascript", "application/xml", "text/markdown", "application/octet-stream", "constructor"]) {
      expect(servedContentType(mime), mime).toBe("text/plain; charset=utf-8");
    }
  });
  it("builds a safe Content-Disposition", () => {
    expect(contentDisposition("a/b/page.html")).toBe(`inline; filename="page.html"; filename*=UTF-8''page.html`);
    expect(contentDisposition('we"ird é.png')).toContain(`filename="we_ird _.png"`);
  });
});

describe("limitBytes", () => {
  const read = (chunks: string[], max: number) => new Response(limitBytes(new Blob(chunks).stream(), max)).text();
  it("passes a stream up to the limit through", async () => {
    expect(await read(["abc", "de"], 5)).toBe("abcde");
  });
  it("fails with too_large past the limit", async () => {
    await expect(read(["abc", "def"], 5)).rejects.toSatisfy((err) => err instanceof ArchiveError && err.code === "too_large");
  });
});
