import { describe, expect, it } from "vitest";
import { parseSearch, toTsQuery } from "./search.ts";

describe("toTsQuery", () => {
  it("makes every word a prefix match, all required", () => {
    expect(toTsQuery("rep pdf")).toBe("rep:* & pdf:*");
  });
  it("drops punctuation, including tsquery operators", () => {
    expect(toTsQuery("a'b & (c | !d):*")).toBe("a:* & b:* & c:* & d:*");
  });
  it("keeps non-ASCII letters", () => {
    expect(toTsQuery("Über café")).toBe("Über:* & café:*");
  });
  it("returns null when nothing searchable is left", () => {
    expect(toTsQuery("  !?  ")).toBeNull();
    expect(toTsQuery("")).toBeNull();
  });
});

describe("parseSearch", () => {
  // Whitespace left behind where a tag was cut out does not matter (toTsQuery splits on it).
  const parse = (input: string) => {
    const { words, tags } = parseSearch(input);
    return { words: words.replace(/\s+/g, " ").trim(), tags };
  };

  it("splits words from #tags", () => {
    expect(parse("report #work 2026 #urgent")).toEqual({ words: "report 2026", tags: ["work", "urgent"] });
  });
  it("lowercases tags and drops duplicates", () => {
    expect(parse("#Work #WORK #work").tags).toEqual(["work"]);
  });
  it("accepts a quoted tag with spaces", () => {
    expect(parse('#"My Tag" note')).toEqual({ words: "note", tags: ["my tag"] });
  });
  it("only treats a # at the start of a word as a tag", () => {
    expect(parse("c#sharp a#b")).toEqual({ words: "c#sharp a#b", tags: [] });
  });
  it("ignores a lone #", () => {
    expect(parse("# word #")).toEqual({ words: "word", tags: [] });
  });
  it("leaves a query without tags alone", () => {
    expect(parse("just words")).toEqual({ words: "just words", tags: [] });
  });
});
