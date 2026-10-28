// What the editor's extensions need from the page around them. Created once per editor
// (Editor.tsx) and closed over by the extension factories in extensions.ts.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EntrySummary } from "../../../../../src/shared/archive.ts";

export type ArchivePick = (mode: "embed" | "link") => Promise<EntrySummary | null>;

// The link dialog: what is there now (the link under the cursor, the selected text); resolves
// with the link to apply (`href: null` removes it), or null when cancelled.
export type LinkRequest = { href: string; text: string; hasSelection: boolean };
export type LinkAsk = (request: LinkRequest) => Promise<{ href: string | null; text: string } | null>;

export type NotesEditorContext = {
  // The page being edited (video embeds remember their position per page and block).
  pageId: string;
  // pageId -> current title, for page and block links. Starts from the server's Page.linkTitles;
  // links inserted in this session add their target. A page missing here shows as broken.
  titles: Map<string, string>;
  // Follows a link inside the app (router navigation).
  open: (href: string) => void;
  // Opens the archive picker; resolves with the chosen entry, or null if cancelled.
  pickArchive: ArchivePick;
  // Opens the web link dialog (LinkDialog.tsx).
  askLink: LinkAsk;
};

// A node attribute that should be a string (ProseMirror types attrs as `any`).
export function strAttr(node: PMNode, name: string): string | null {
  const value: unknown = node.attrs[name];
  return typeof value === "string" && value !== "" ? value : null;
}

export const pageHref = (pageId: string, blockId?: string | null) => `/notes/p/${pageId}${blockId ? `#${encodeURIComponent(blockId)}` : ""}`;
export const entryHref = (entryId: string) => `/archive/e/${entryId}`;
