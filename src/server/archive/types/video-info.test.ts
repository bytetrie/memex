import { describe, expect, it } from "vitest";
import { InfoSchema, checkPlaylist, isoDate, looksLike, parseJsonObject, trimInfo } from "./video-info.ts";

describe("video info", () => {
  it("keeps the fields it knows, drops bad ones instead of failing", () => {
    const info = InfoSchema.parse({ id: "x", title: 42, duration: -1, upload_date: "2005-04-23", channel: "c".repeat(400), webpage_url: "https://a.example/v" });
    expect(info).toEqual({ id: "x", webpage_url: "https://a.example/v" });
  });

  it("trims formats, URLs and caption lists", () => {
    expect(trimInfo({ id: "x", formats: [], url: "https://cdn/x?token", automatic_captions: {}, description: "d" })).toEqual({ id: "x", description: "d" });
  });

  it("reads dates and JSON objects", () => {
    expect(isoDate("20050423")).toBe("2005-04-23");
    expect(parseJsonObject(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
    expect(() => parseJsonObject(new TextEncoder().encode("[1]"))).toThrow();
    expect(() => parseJsonObject(new Uint8Array([0xff, 0xfe]))).toThrow();
  });

  it("recognises files by their first bytes", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(looksLike.mp4(bytes("\0\0\0 ftypiso6"))).toBe(true);
    expect(looksLike.mp4(bytes("<html>"))).toBe(false);
    expect(looksLike.avif(bytes("\0\0\0 ftypavis"))).toBe(true);
    expect(looksLike.avif(bytes("\0\0\0 ftypiso6"))).toBe(false);
    expect(looksLike.jpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLike.jpeg(bytes("GIF89a"))).toBe(false);
  });

  it("accepts only a playlist that refers to its own media file", () => {
    const good = '#EXTM3U\n#EXT-X-MAP:URI="media.mp4",BYTERANGE="10@0"\n#EXTINF:5.0,\n#EXT-X-BYTERANGE:20@10\nmedia.mp4\n#EXT-X-ENDLIST\n';
    expect(checkPlaylist(good, "media.mp4")).toBe(true);
    expect(checkPlaylist(good.replace("\nmedia.mp4\n", "\nhttps://evil.example/a.mp4\n"), "media.mp4")).toBe(false);
    expect(checkPlaylist(good.replace('URI="media.mp4"', 'URI="../../secret"'), "media.mp4")).toBe(false);
    expect(checkPlaylist(good.replace("#EXT-X-ENDLIST\n", ""), "media.mp4")).toBe(false);
    expect(checkPlaylist("media.mp4\n", "media.mp4")).toBe(false);
  });
});
