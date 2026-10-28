// A note page's content: ProseMirror JSON as Tiptap's editor.getJSON() produces it, stored as is.
// The server never runs Tiptap; it checks the shape and limits (DocSchema) and reads what it
// indexes with analyzeDoc(): plain text for search, the blocks (for (( links), the links between
// pages (backlinks), the archive entries a page uses (archive refs) and its drawings.
// Node names live here, once: the editor's extensions (web/src/modules/notes/editor/) use them too.

import { z } from "zod";

export const NOTE_NODES = {
  // Block atom: an archive entry shown in the page. attrs: { entryId, bookmarks? }
  // bookmarks (video entries): [{ t: seconds, label }], read with parseBookmarks().
  archiveEmbed: "archiveEmbed",
  // Inline atom: a link to an archive entry. attrs: { entryId, label }
  archiveLink: "archiveLink",
  // Inline atom: a link to another page. attrs: { pageId }
  pageLink: "pageLink",
  // Inline atom: a link to a block of a page. attrs: { pageId, blockId }
  blockLink: "blockLink",
  // Block atom: an Excalidraw drawing, stored on its own (notes_drawings). attrs: { drawingId }
  drawing: "drawing",
} as const;

// Node types that carry a block id (attrs.id, from Tiptap's UniqueID extension): what a block
// link can point at. List items hold paragraphs, which have their own ids.
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "codeBlock", NOTE_NODES.archiveEmbed, NOTE_NODES.drawing] as const;

export const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "a block id");

export const MAX_DOC_DEPTH = 48;
export const MAX_DOC_NODES = 50_000;
// Stored per block for (( search and backlink snippets.
export const BLOCK_TEXT_MAX = 500;

export type DocMark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: DocMark[]; text?: string };

const AttrsSchema = z.record(z.string(), z.unknown());
const MarkSchema = z.object({ type: z.string().min(1).max(64), attrs: AttrsSchema.optional() });
const NodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: AttrsSchema.optional(),
    content: z.array(NodeSchema).optional(),
    marks: z.array(MarkSchema).optional(),
    text: z.string().optional(),
  }),
);

// Counted without recursion before zod walks the tree, so a deeply nested body can't exhaust
// the stack.
function withinLimits(value: unknown): boolean {
  let nodes = 0;
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  for (let item = stack.pop(); item; item = stack.pop()) {
    if (++nodes > MAX_DOC_NODES || item.depth > MAX_DOC_DEPTH) return false;
    const { node } = item;
    if (typeof node !== "object" || node === null || !("content" in node)) continue;
    const { content } = node;
    if (!Array.isArray(content)) continue;
    for (const child of content) stack.push({ node: child, depth: item.depth + 1 });
  }
  return true;
}

export const DocSchema = z
  .custom<unknown>(withinLimits, `a document of at most ${String(MAX_DOC_NODES)} nodes, nested at most ${String(MAX_DOC_DEPTH)} deep`)
  .pipe(NodeSchema)
  .refine((d) => d.type === "doc", "the top node must be a doc");
export type Doc = DocNode;

export const emptyDoc = (): Doc => ({ type: "doc", content: [{ type: "paragraph" }] });

// A labelled point in a video embed, stored on the block (attrs.bookmarks) and saved with the page.
// Where the video was left playing is not in the doc: it is remembered per browser.
export const VideoBookmarkSchema = z.object({
  t: z.number().min(0).max(7 * 24 * 3600),
  label: z.string().trim().min(1).max(200),
});
export type VideoBookmark = z.infer<typeof VideoBookmarkSchema>;
export const MAX_BOOKMARKS = 200;

// Lenient: entries that don't parse (a hand-made doc) are dropped; the rest come sorted by time.
export function parseBookmarks(value: unknown): VideoBookmark[] {
  if (!Array.isArray(value)) return [];
  const marks: VideoBookmark[] = [];
  for (const item of value) {
    const parsed = VideoBookmarkSchema.safeParse(item);
    if (parsed.success) marks.push(parsed.data);
  }
  return marks.sort((a, b) => a.t - b.t).slice(0, MAX_BOOKMARKS);
}

export type DocBlock = { id: string; type: string; text: string; position: number };
export type DocLink = { fromBlockId: string | null; toPageId: string; toBlockId: string | null };
export type DocAnalysis = {
  text: string;
  blocks: DocBlock[];
  links: DocLink[];
  archiveIds: string[];
  drawingIds: string[];
};

const Uuid = z.uuid();
const blockTypes = new Set<string>(BLOCK_TYPES);
// eslint-disable-next-line security/detect-object-injection -- `name` is always a literal from this file
const attr = (node: DocNode, name: string): unknown => (node.attrs && Object.hasOwn(node.attrs, name) ? node.attrs[name] : undefined);
const uuidAttr = (node: DocNode, name: string): string | null => {
  const parsed = Uuid.safeParse(attr(node, name));
  return parsed.success ? parsed.data : null;
};

// Inline atoms that carry their visible text as `label` (links to pages, blocks, archive entries).
const labelled = new Set<string>([NOTE_NODES.pageLink, NOTE_NODES.blockLink, NOTE_NODES.archiveLink]);

function textOf(node: DocNode): string {
  if (node.text !== undefined) return node.text;
  // An embed's text is its bookmark labels, so a search finds the video by them.
  if (node.type === NOTE_NODES.archiveEmbed) return parseBookmarks(attr(node, "bookmarks")).map((b) => b.label).join("\n");
  if (labelled.has(node.type)) {
    const label = attr(node, "label");
    return typeof label === "string" ? label : "";
  }
  const parts = (node.content ?? []).map(textOf);
  // Blocks inside a block (a list in a quote) are separated like lines.
  return node.content?.some((c) => c.content !== undefined) ? parts.join("\n") : parts.join("");
}

// Everything the server indexes from a page. Attributes that don't parse (a hand-made doc) are
// skipped, not refused: the doc is stored as sent either way.
export function analyzeDoc(doc: Doc): DocAnalysis {
  const blocks: DocBlock[] = [];
  const seenBlocks = new Set<string>();
  const links: DocLink[] = [];
  const archiveIds = new Set<string>();
  const drawingIds = new Set<string>();

  const walk = (node: DocNode, blockId: string | null) => {
    let current = blockId;
    const id = BlockIdSchema.safeParse(attr(node, "id"));
    if (blockTypes.has(node.type) && id.success) {
      current = id.data;
      // UniqueID removes duplicates in the editor; a hand-made doc might still have them.
      if (!seenBlocks.has(id.data)) {
        seenBlocks.add(id.data);
        blocks.push({ id: id.data, type: node.type, text: textOf(node).slice(0, BLOCK_TEXT_MAX), position: blocks.length });
      }
    }
    switch (node.type) {
      case NOTE_NODES.pageLink: {
        const pageId = uuidAttr(node, "pageId");
        if (pageId) links.push({ fromBlockId: current, toPageId: pageId, toBlockId: null });
        break;
      }
      case NOTE_NODES.blockLink: {
        const pageId = uuidAttr(node, "pageId");
        const target = BlockIdSchema.safeParse(attr(node, "blockId"));
        if (pageId && target.success) links.push({ fromBlockId: current, toPageId: pageId, toBlockId: target.data });
        break;
      }
      case NOTE_NODES.archiveEmbed:
      case NOTE_NODES.archiveLink: {
        const entryId = uuidAttr(node, "entryId");
        if (entryId) archiveIds.add(entryId);
        break;
      }
      case NOTE_NODES.drawing: {
        const drawingId = uuidAttr(node, "drawingId");
        if (drawingId) drawingIds.add(drawingId);
        break;
      }
    }
    for (const child of node.content ?? []) walk(child, current);
  };
  walk(doc, null);

  return { text: textOf(doc), blocks, links, archiveIds: [...archiveIds], drawingIds: [...drawingIds] };
}
