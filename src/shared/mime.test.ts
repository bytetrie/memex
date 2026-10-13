import { describe, expect, it } from "vitest";
import { isTextMime, textMimeFor } from "./mime.ts";

describe("text mime types", () => {
  it("recognises text kinds", () => {
    for (const m of ["text/plain", "text/markdown", "text/csv", "application/json", "application/xml", "text/vtt"]) expect(isTextMime(m), m).toBe(true);
    for (const m of ["application/pdf", "image/png", "video/mp4", "application/octet-stream", "application/zip"]) expect(isTextMime(m), m).toBe(false);
  });
  it("keeps a declared text type", () => {
    expect(textMimeFor("text/csv", "whatever.bin")).toBe("text/csv");
  });
  it("ignores a declared non-text type and uses the extension", () => {
    expect(textMimeFor("application/vnd.ms-excel", "data.CSV")).toBe("text/csv");
    expect(textMimeFor("application/pdf", "notes.md")).toBe("text/markdown");
    expect(textMimeFor("", "subs.vtt")).toBe("text/vtt");
  });
  it("falls back to plain text for code, logs and unknown extensions", () => {
    for (const name of ["main.rs", "server.log", "Makefile", "x.unknownext"]) expect(textMimeFor(undefined, name)).toBe("text/plain");
  });
  it("does not read Object's own properties for an extension", () => {
    for (const name of ["x.constructor", "x.__proto__", "x.toString"]) expect(textMimeFor(undefined, name)).toBe("text/plain");
  });
});
