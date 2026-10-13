import { describe, expect, it } from "vitest";
import { dedupeCues, parseTimestamp, parseVtt, transcriptCues } from "./vtt.ts";

describe("parseTimestamp", () => {
  it("reads hh:mm:ss.mmm and mm:ss.mmm", () => {
    expect(parseTimestamp("01:02:03.500")).toBe(3723.5);
    expect(parseTimestamp("02:03.250")).toBe(123.25);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "3.5", "aa:bb.ccc", "01:02:03", "1:2:3:4.000"]) expect(parseTimestamp(bad), bad).toBeNull();
  });
});

describe("parseVtt", () => {
  it("reads cues, strips tags and entities, skips headers and notes", () => {
    const vtt = "\uFEFFWEBVTT\nKind: captions\n\nNOTE a comment\n\n1\n00:00:01.000 --> 00:00:02.500 align:start\n<v Bob>Hello &amp; <b>welcome</b></v>\n\n00:00:03.000 --> 00:00:04.000\r\nsecond\r\nline\r\n";
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 2.5, text: "Hello & welcome" },
      { start: 3, end: 4, text: "second\nline" },
    ]);
  });
  it("caps the number of cues", () => {
    const vtt = "WEBVTT\n\n" + Array.from({ length: 10 }, (_, i) => `00:00:0${String(i)}.000 --> 00:00:0${String(i)}.500\nx${String(i)}\n`).join("\n");
    expect(parseVtt(vtt, 3)).toHaveLength(3);
  });
});

describe("dedupeCues", () => {
  it("reads YouTube's rolling automatic captions once", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "so today we<00:00:00.500><c> talk</c>",
      "",
      "00:00:02.000 --> 00:00:02.010",
      "so today we talk",
      "",
      "00:00:02.010 --> 00:00:04.000",
      "so today we talk",
      "about elephants",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "about elephants",
      "and their trunks",
    ].join("\n");
    expect(transcriptCues(vtt).map((c) => c.text)).toEqual(["so today we talk", "about elephants", "and their trunks"]);
  });
  it("keeps a line that comes back later", () => {
    const cues = ["a", "b", "c", "d", "e", "a"].map((text, i) => ({ start: i, end: i + 1, text }));
    expect(dedupeCues(cues).map((c) => c.text)).toEqual(["a", "b", "c", "d", "e", "a"]);
  });
});
