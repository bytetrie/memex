// The text side of code blocks, kept pure for tests: a language-agnostic tokenizer for the syntax
// colours (codeHighlight.ts) and what Enter does to indentation (codeBlockExit.ts).
//
// The tokenizer knows no language: it colours comments (// /* */ <!-- --> and, after a space or at a
// line start, "# " and "-- "), strings ('' "" `` and triple quotes), numbers, common keywords and
// literals of the usual languages (SQL keywords in capitals too), and names followed by "(".

export type TokenKind = "comment" | "string" | "number" | "keyword" | "literal" | "function";
export type Token = { from: number; to: number; kind: TokenKind };

const KEYWORDS = new Set(
  (
    "abstract and as async await begin break case catch class const continue def default defer del delete do elif else " +
    "end enum except export extends final finally fn for from func function go if impl implements import in instanceof " +
    "interface is lambda let loop match mod module mut namespace new not of or package pass private protected pub " +
    "public raise readonly return select static struct super switch then throw throws trait try type typeof unless " +
    "until use using var void where while with yield " +
    // SQL and shell
    "alter by create drop esac fi group having insert into join limit on order table union update values done " +
    // common type names
    "bool boolean byte char double float int long short str string u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 usize"
  ).split(" "),
);
const LITERALS = new Set(["true", "false", "null", "nil", "none", "undefined", "nan", "self", "this"]);

// One pass, leftmost match wins; anything between matches stays plain.
const TOKEN_RE = new RegExp(
  [
    String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|(?<![^\s])#(?=[\s!#]|$)[^\n]*|(?<![^\s])--(?=\s|$)[^\n]*)`,
    String.raw`(?<string>"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\[\\s\\S])*`)",
    String.raw`(?<word>[A-Za-z_$][\w$]*)`,
    String.raw`(?<number>(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)\b)`,
  ].join("|"),
  "g",
);

function wordKind(word: string, after: string): TokenKind | null {
  // Lower case for most languages; SQL's keywords are often written in capitals.
  const lower = word === word.toUpperCase() ? word.toLowerCase() : word;
  if (LITERALS.has(lower) || word === "None" || word === "True" || word === "False" || word === "NaN") return "literal";
  if (KEYWORDS.has(lower)) return "keyword";
  if (/^\s*\(/.test(after)) return "function";
  return null;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    const g = m.groups ?? {};
    let kind: TokenKind | null = null;
    if (g.comment !== undefined) kind = "comment";
    else if (g.string !== undefined) kind = "string";
    else if (g.number !== undefined) kind = "number";
    else if (g.word !== undefined) kind = wordKind(g.word, text.slice(to, to + 32));
    if (kind && to > from) tokens.push({ from, to, kind });
  }
  return tokens;
}

export const INDENT = "  ";

// Enter in a code block, given its text and the cursor's offset in it (an empty selection):
// - "exit": the cursor is at the end and the last two lines are blank (Enter three times leaves
//   the block); `from` is where the blank lines start, to be deleted;
// - "newline": the new line keeps this line's indent, one step more after an opening ({ [ ( :);
//   a blank line's own spaces are dropped (`from` to the cursor is replaced by `insert`);
// - null: nothing to indent, the editor's default Enter.
export type EnterAction = { kind: "exit"; from: number } | { kind: "newline"; from: number; insert: string } | null;

export function enterInCode(text: string, offset: number): EnterAction {
  const before = text.slice(0, offset);
  if (offset === text.length) {
    const blank = /\n[ \t]*\n[ \t]*$/.exec(before);
    if (blank) return { kind: "exit", from: blank.index };
  }
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (line.length > 0 && line === indent) return { kind: "newline", from: offset - line.length, insert: `\n${indent}` };
  const next = /[{[(:]\s*$/.test(line) ? indent + INDENT : indent;
  if (next === "") return null;
  return { kind: "newline", from: offset, insert: `\n${next}` };
}
