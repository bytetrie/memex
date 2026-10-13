import { describe, expect, it } from "vitest";
import { FileInputSchema, TextInputSchema, isValidFileName } from "./archive-types.ts";

describe("isValidFileName", () => {
  it("accepts plain and nested names", () => {
    for (const n of ["a.pdf", "hls/index.m3u8", "naïve file (1).txt", ".hidden"]) expect(isValidFileName(n)).toBe(true);
  });
  it("rejects traversal, empty segments, backslashes and control characters", () => {
    for (const n of ["", "/a", "a/", "a//b", "../a", "a/./b", "a/..", "a\\b", "a\nb", "a\u0000b", "x".repeat(256)]) {
      expect(isValidFileName(n), JSON.stringify(n)).toBe(false);
    }
  });
});

describe("type inputs", () => {
  const sha = "a".repeat(64);
  it("file: needs at least one file with a valid hash and unique names", () => {
    expect(FileInputSchema.safeParse({ files: [] }).success).toBe(false);
    expect(FileInputSchema.safeParse({ files: [{ sha256: "xyz", name: "a" }] }).success).toBe(false);
    expect(FileInputSchema.safeParse({ files: [{ sha256: sha, name: "a" }, { sha256: sha, name: "a" }] }).success).toBe(false);
    expect(FileInputSchema.safeParse({ files: [{ sha256: sha, name: "a" }, { sha256: sha, name: "b", mime: "text/plain" }] }).success).toBe(true);
  });
  it("text: rejects blank text", () => {
    expect(TextInputSchema.safeParse({ text: "  \n " }).success).toBe(false);
    expect(TextInputSchema.parse({ text: " hi " }).text).toBe("hi");
  });
});
