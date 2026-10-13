// type "text": pasted text or Markdown. The server writes it to content.md, so
// this is the example of a type whose files are generated from form input.

import { TextInputSchema } from "../../../shared/archive-types.ts";
import { defineType } from "./define.ts";

// First non-empty line, minus Markdown heading marks, capped at 80 characters.
export function titleFromText(text: string): string {
  const line = text.split("\n").find((l) => l.replace(/^#+/, "").trim() !== "") ?? "";
  const title = line.replace(/^#+/, "").trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title || "Untitled text";
}

export const textType = defineType({
  label: "Text",
  input: TextInputSchema,
  async ingest({ text }, ctx) {
    const { sha256 } = await ctx.putBlob(new Blob([text]).stream());
    return {
      title: titleFromText(text),
      searchText: text,
      files: [{ sha256, name: "content.md", mime: "text/markdown", role: "original" }],
    };
  },
});
