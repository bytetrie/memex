import { describe, expect, it } from "vitest";
import { inspectText } from "./text.ts";

const stream = (...chunks: (string | number[])[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? new TextEncoder().encode(c) : new Uint8Array(c));
      controller.close();
    },
  });

describe("inspectText", () => {
  it("accepts text and returns its start", async () => {
    expect(await inspectText(stream("hello world"), 5)).toEqual({ ok: true, head: "hello" });
  });
  it("accepts non-ASCII text, tabs, newlines and ANSI escapes", async () => {
    const text = "naïve café 日本語 😀\n\tcol\r\n\u001b[31mred\u001b[0m\f";
    expect(await inspectText(stream(text), 1000)).toEqual({ ok: true, head: text });
  });
  it("keeps a multi-byte character that is split across chunks", async () => {
    const bytes = [...new TextEncoder().encode("a😀b")];
    expect(await inspectText(stream(bytes.slice(0, 3), bytes.slice(3)), 100)).toEqual({ ok: true, head: "a😀b" });
  });
  it("collects the head across chunks", async () => {
    expect(await inspectText(stream("abc", "def", "ghi"), 5)).toEqual({ ok: true, head: "abcde" });
  });
  it("refuses binary data (NUL and other control characters)", async () => {
    expect(await inspectText(stream("text\u0000more"), 100)).toMatchObject({ ok: false, reason: "contains binary data" });
    expect(await inspectText(stream([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 100)).toMatchObject({ ok: false });
    expect(await inspectText(stream("a\u0001b"), 100)).toMatchObject({ ok: false, reason: "contains binary data" });
  });
  it("refuses bytes that are not UTF-8, including a file cut inside a character", async () => {
    expect(await inspectText(stream([0xff, 0xfe, 0x41]), 100)).toMatchObject({ ok: false, reason: "is not valid UTF-8 text" });
    expect(await inspectText(stream([0x61, 0xf0, 0x9f]), 100)).toMatchObject({ ok: false, reason: "is not valid UTF-8 text" });
  });
  it("refuses empty and whitespace-only files", async () => {
    expect(await inspectText(stream(), 100)).toMatchObject({ ok: false, reason: "has no text in it" });
    expect(await inspectText(stream(" \n\t "), 100)).toMatchObject({ ok: false, reason: "has no text in it" });
  });
});
