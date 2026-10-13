import { describe, expect, it } from "vitest";
import { titleFromText } from "./text.ts";

describe("titleFromText", () => {
  it("uses the first non-empty line without heading marks", () => {
    expect(titleFromText("\n\n## Trip notes\nmore")).toBe("Trip notes");
  });
  it("caps long titles", () => {
    const title = titleFromText("x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
  it("falls back when only marks are present", () => {
    expect(titleFromText("###\n  ")).toBe("Untitled text");
  });
});
