// type "file": text files only (notes, Markdown, JSON, CSV, code, logs, subtitles...), uploaded
// earlier with PUT /archive/blobs. The archive is for things that can be searched and
// referenced, so bytes that can't be read (images, video, archives, ...) are refused. The
// text is indexed for search, and the server picks each file's mime type.

import { FileInputSchema } from "../../../shared/archive-types.ts";
import { textMimeFor } from "../../../shared/mime.ts";
import { ArchiveError } from "../ports.ts";
import { defineType } from "./define.ts";

const INDEXED_CHARS = 200_000; // what the search index keeps of an entry (see db/schema.ts)

export const fileType = defineType({
  label: "Text file",
  input: FileInputSchema,
  async ingest({ files }, ctx) {
    const heads: string[] = [];
    const problems: { path: string; message: string }[] = [];
    const refused = new Set<string>();
    try {
      for (const [i, f] of files.entries()) {
        const text = await ctx.readText(f.sha256, INDEXED_CHARS);
        if (!text) throw new ArchiveError("unknown_blob", `blob ${f.sha256} was not uploaded`);
        if (text.ok) heads.push(text.head);
        else {
          problems.push({ path: `files.${String(i)}`, message: `${f.name} ${text.reason}; only text files can be added` });
          refused.add(f.sha256);
        }
      }
      if (problems.length) throw new ArchiveError("invalid", problems.map((p) => p.message).join("; "), problems);
    } catch (err) {
      // Refused bytes go right away. The text files of the same request stay uploaded, so the
      // caller can retry without the bad one.
      for (const sha256 of refused) await ctx.discardBlob(sha256);
      throw err;
    }
    const name = files[0]?.name ?? ""; // FileInputSchema requires at least one file
    return {
      title: name.split("/").pop() ?? name,
      searchText: heads.join("\n").slice(0, INDEXED_CHARS),
      files: files.map((f) => ({ sha256: f.sha256, name: f.name, mime: textMimeFor(f.mime, f.name), role: "original" })),
    };
  },
});
