// Notes API shapes shared by server and web (design: ideas/notes.md).
// Notes are editable pages; they reference archive entries but keep none of their own data there.

import { z } from "zod";
import { BlockIdSchema, DocSchema } from "./notes-doc.ts";
import { TagSchema, TagsSchema } from "./tags.ts";

export const PageIdSchema = z.uuid();
export const PageTitleSchema = z.string().trim().max(300);

export const PageSummarySchema = z.object({
  id: PageIdSchema,
  title: z.string(),
  tags: z.array(z.string()),
  // The start of the page's text.
  snippet: z.string(),
  updatedAt: z.iso.datetime(),
});
export type PageSummary = z.infer<typeof PageSummarySchema>;

export const PageListSchema = z.object({
  items: z.array(PageSummarySchema),
  nextCursor: z.string().nullable(),
});
export type PageList = z.infer<typeof PageListSchema>;

export const PageListQuerySchema = z.object({
  q: z.string().max(200).optional().describe('Words (prefix matches, all required) and #tags, e.g. "plan #work".'),
  tag: TagSchema.optional().describe("One more tag that must be on the page (same as #tag in q)."),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(100).optional().describe("nextCursor of the previous page of results."),
});
export type PageListQuery = z.infer<typeof PageListQuerySchema>;

export const PageSchema = PageSummarySchema.omit({ snippet: true }).extend({
  doc: DocSchema,
  // Increases with every save; a save names the version it started from (SavePage.baseVersion).
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  // Current titles of the pages this page links to; a linked page missing here no longer exists.
  linkTitles: z.record(PageIdSchema, z.string()),
});
export type Page = z.infer<typeof PageSchema>;

export const CreatePageSchema = z.object({
  title: PageTitleSchema.optional(),
  tags: TagsSchema.optional(),
  doc: DocSchema.optional(),
});
export type CreatePage = z.infer<typeof CreatePageSchema>;

export const SavePageSchema = z.object({
  title: PageTitleSchema,
  doc: DocSchema,
  baseVersion: z.number().int().min(1),
});
export type SavePage = z.infer<typeof SavePageSchema>;

export const SavedSchema = z.object({ version: z.number().int(), updatedAt: z.iso.datetime() });
export type Saved = z.infer<typeof SavedSchema>;

// 409 of a save or drawing save: someone saved since baseVersion.
export const VersionConflictSchema = z.object({ error: z.string(), version: z.number().int() });

export const PatchPageSchema = z.object({ tags: TagsSchema });
export type PatchPage = z.infer<typeof PatchPageSchema>;

export const BacklinkSchema = z.object({
  pageId: PageIdSchema,
  pageTitle: z.string(),
  // The block holding the link, and its text (empty when the link is outside any block).
  blockId: BlockIdSchema.nullable(),
  text: z.string(),
  // The block linked to; null for a link to the whole page.
  targetBlockId: BlockIdSchema.nullable(),
});
export type Backlink = z.infer<typeof BacklinkSchema>;
export const BacklinksSchema = z.object({ items: z.array(BacklinkSchema) });

export const BlockHitSchema = z.object({
  pageId: PageIdSchema,
  pageTitle: z.string(),
  blockId: BlockIdSchema,
  type: z.string(),
  text: z.string(),
});
export type BlockHit = z.infer<typeof BlockHitSchema>;
export const BlockHitsSchema = z.object({ items: z.array(BlockHitSchema) });
export const BlockQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const TagCountSchema = z.object({ tag: z.string(), count: z.number().int() });
export const TagCountsSchema = z.object({ items: z.array(TagCountSchema) });
export type TagCount = z.infer<typeof TagCountSchema>;

// An Excalidraw scene as the drawing block saves it: its elements and the app state worth keeping.
// Opaque to the server beyond this shape. No `files`: the image tool is off (ideas/notes.md).
export const SceneSchema = z.object({
  elements: z.array(z.record(z.string(), z.unknown())).max(20_000),
  appState: z.record(z.string(), z.unknown()).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const DrawingSchema = z.object({
  id: z.uuid(),
  scene: SceneSchema,
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type Drawing = z.infer<typeof DrawingSchema>;

export const SaveDrawingSchema = z.object({ scene: SceneSchema, baseVersion: z.number().int().min(1) });
export type SaveDrawing = z.infer<typeof SaveDrawingSchema>;
