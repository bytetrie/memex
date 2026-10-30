import { describe, expect, it } from "vitest";
import { enterInCode, tokenize, type TokenKind } from "./codeText.ts";

const kinds = (text: string) => tokenize(text).map((t): [string, TokenKind] => [text.slice(t.from, t.to), t.kind]);

describe("code tokens", () => {
  it("colours the usual pieces of any language", () => {
    expect(kinds(`const n = parse("a // b", 0x1F); // done`)).toEqual([
      ["const", "keyword"],
      ["parse", "function"],
      [`"a // b"`, "string"],
      ["0x1F", "number"],
      ["// done", "comment"],
    ]);
    expect(kinds("def f(x):\n    return None  # nothing")).toEqual([
      ["def", "keyword"],
      ["f", "function"],
      ["return", "keyword"],
      ["None", "literal"],
      ["# nothing", "comment"],
    ]);
    expect(kinds("SELECT id FROM t WHERE x = 'y' -- why")).toEqual([
      ["SELECT", "keyword"],
      ["FROM", "keyword"],
      ["WHERE", "keyword"],
      ["'y'", "string"],
      ["-- why", "comment"],
    ]);
  });

  it("doesn't take #, -- or digits inside other things for tokens", () => {
    expect(kinds("#include <x>\na#b; i--; v2")).toEqual([]);
    expect(kinds("/* open\nstill */ 1.5e3")).toEqual([
      ["/* open\nstill */", "comment"],
      ["1.5e3", "number"],
    ]);
    expect(kinds("`multi\nline`")).toEqual([["`multi\nline`", "string"]]);
  });
});

describe("Enter in code", () => {
  it("keeps the indent, one step more after an opening", () => {
    expect(enterInCode("  foo", 5)).toEqual({ kind: "newline", from: 5, insert: "\n  " });
    expect(enterInCode("if (x) {", 8)).toEqual({ kind: "newline", from: 8, insert: "\n  " });
    expect(enterInCode("  def f():", 10)).toEqual({ kind: "newline", from: 10, insert: "\n    " });
    expect(enterInCode("foo", 3)).toBeNull();
  });

  it("drops a blank line's spaces but keeps its indent for the next", () => {
    expect(enterInCode("  foo\n  ", 8)).toEqual({ kind: "newline", from: 6, insert: "\n  " });
  });

  it("leaves the block after two blank lines at the end", () => {
    expect(enterInCode("foo\n\n", 5)).toEqual({ kind: "exit", from: 3 });
    expect(enterInCode("  foo\n\n  ", 9)).toEqual({ kind: "exit", from: 5 });
    expect(enterInCode("foo\n\nbar", 4)).toBeNull();
  });
});
