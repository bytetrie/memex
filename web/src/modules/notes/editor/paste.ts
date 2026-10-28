// What pasting does beyond the default:
// - an archive entry on its own (`archive:<id>`, or a link to /archive/e/<id> on this site) becomes
//   an embed of that entry;
// - plain text that looks like markdown (no HTML on the clipboard) is parsed as markdown
//   (@tiptap/markdown), so pasted notes keep their headings, lists and emphasis.
// Markdown typed in the editor is handled by StarterKit's input rules ("# ", "- ", "**bold**"...).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NOTE_NODES } from "../../../../../src/shared/notes-doc.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ARCHIVE_REF = new RegExp(`^archive:(${UUID})$`, "i");
const ARCHIVE_PATH = new RegExp(`^/archive/e/(${UUID})/?$`, "i");

// Lines starting like a markdown block, or inline emphasis/code/links anywhere.
const MARKDOWN = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/;

export function archiveIdFromText(text: string): string | null {
  const t = text.trim();
  const ref = ARCHIVE_REF.exec(t);
  if (ref?.[1]) return ref[1].toLowerCase();
  try {
    const url = new URL(t, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const path = ARCHIVE_PATH.exec(url.pathname);
    return path?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export const looksLikeMarkdown = (text: string) => MARKDOWN.test(text);

export const NotesPaste = Extension.create({
  name: "notesPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("notesPaste"),
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            if (!data) return false;
            const text = data.getData("text/plain");
            if (!text || editor.isActive("codeBlock")) return false;
            const entryId = archiveIdFromText(text);
            if (entryId) {
              return editor.chain().focus().insertContent({ type: NOTE_NODES.archiveEmbed, attrs: { entryId } }).run();
            }
            if (data.getData("text/html") || !looksLikeMarkdown(text) || !editor.markdown) return false;
            return editor.chain().focus().insertContent(editor.markdown.parse(text)).run();
          },
        },
      }),
    ];
  },
});
