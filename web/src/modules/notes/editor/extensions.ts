// Every extension the notes editor uses, in one list: adding a block type or a menu means adding
// it here (AGENTS.md "Add a block type to notes"). Node names come from src/shared/notes-doc.ts,
// which the server reads too (blocks, links, archive refs, drawings).
//
// Performance rules the extensions follow (ideas/notes.md):
// - text blocks (paragraphs, headings, lists, quotes, code) have no node views: ProseMirror
//   renders them as plain DOM;
// - inline links are plain DOM node views (nodes/links.ts);
// - only heavy embeds are React node views, memoised so typing never re-renders them
//   (nodes/ArchiveEmbed.tsx, nodes/Drawing.tsx).

import UniqueID from "@tiptap/extension-unique-id";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { BLOCK_TYPES } from "../../../../../src/shared/notes-doc.ts";
import { BlockFlash } from "./blockFlash.ts";
import { CodeBlockExit } from "./codeBlockExit.ts";
import type { NotesEditorContext } from "./context.ts";
import { archiveEmbedNode } from "./nodes/ArchiveEmbed.tsx";
import { Drawing } from "./nodes/Drawing.tsx";
import { archiveLinkNode, blockLinkNode, pageLinkNode } from "./nodes/links.ts";
import { NotesPaste } from "./paste.ts";
import { suggestionMenus } from "./suggestions.ts";
import { webLinks } from "./webLinks.ts";

export function createExtensions(ctx: NotesEditorContext) {
  return [
    StarterKit.configure({
      // Links in text: typed or pasted URLs become links; a click doesn't leave the page while editing.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    // [text](address), Mod-K, Ctrl/Cmd-click (webLinks.ts).
    webLinks(ctx),
    CodeBlockExit,
    BlockFlash,
    // Only used to parse pasted markdown (paste.ts); pages are stored as ProseMirror JSON.
    Markdown,
    // Gives every block a stable id (rendered as data-id), so other pages can link to it.
    UniqueID.configure({ types: [...BLOCK_TYPES], attributeName: "id", generateID: () => crypto.randomUUID() }),
    pageLinkNode(ctx),
    blockLinkNode(ctx),
    archiveLinkNode(ctx),
    archiveEmbedNode(ctx),
    Drawing,
    NotesPaste,
    ...suggestionMenus(ctx),
  ];
}
