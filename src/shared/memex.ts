// Memex API shapes shared by server and web (design: ideas/printable.md). Memex pages are
// printable sheets; their files (images, SVGs, drawings) live in the memex's own asset store,
// never in the archive. Shapes that are the same as notes' are reused from notes.ts.

import { z } from "zod";
import { FormatSchema, PageDocSchema, Sha256Schema } from "./memex-doc.ts";
import { PageTitleSchema, SavedSchema, TagCountsSchema, VersionConflictSchema, type Saved } from "./notes.ts";
import { TagSchema, TagsSchema } from "./tags.ts";

export { SavedSchema, TagCountsSchema, VersionConflictSchema, type Saved };

export const MemexPageIdSchema = z.uuid();

export const MemexPageSummarySchema = z.object({
  id: MemexPageIdSchema,
  title: z.string(),
  tags: z.array(z.string()),
  format: FormatSchema,
  // The start of the page's text.
  snippet: z.string(),
  updatedAt: z.iso.datetime(),
});
export type MemexPageSummary = z.infer<typeof MemexPageSummarySchema>;

export const MemexPageListSchema = z.object({
  items: z.array(MemexPageSummarySchema),
  nextCursor: z.string().nullable(),
});
export type MemexPageList = z.infer<typeof MemexPageListSchema>;

export const MemexPageListQuerySchema = z.object({
  q: z.string().max(200).optional().describe('Words (prefix matches, all required) and #tags, e.g. "zine #2026".'),
  tag: TagSchema.optional().describe("One more tag that must be on the page (same as #tag in q)."),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(100).optional().describe("nextCursor of the previous page of results."),
});
export type MemexPageListQuery = z.infer<typeof MemexPageListQuerySchema>;

export const MemexPageSchema = MemexPageSummarySchema.omit({ snippet: true, format: true }).extend({
  doc: PageDocSchema,
  // Increases with every save; a save names the version it started from (baseVersion).
  version: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type MemexPage = z.infer<typeof MemexPageSchema>;

export const CreateMemexPageSchema = z.object({
  title: PageTitleSchema.optional(),
  tags: TagsSchema.optional(),
  doc: PageDocSchema.optional(),
});
export type CreateMemexPage = z.infer<typeof CreateMemexPageSchema>;

export const SaveMemexPageSchema = z.object({
  title: PageTitleSchema,
  doc: PageDocSchema,
  baseVersion: z.number().int().min(1),
});
export type SaveMemexPage = z.infer<typeof SaveMemexPageSchema>;

export const PatchMemexPageSchema = z.object({ tags: TagsSchema });

// --- assets --------------------------------------------------------------------------------

// What an asset may be; the server decides from the bytes, never from the request.
export const ASSET_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "application/json"] as const;
export const AssetMimeSchema = z.enum(ASSET_MIMES);
export type AssetMime = z.infer<typeof AssetMimeSchema>;

// Raster images are generous (a phone photo); SVG and scene JSON are read whole to check them.
export const MAX_ASSET_BYTES = 64 * 1024 ** 2;
export const MAX_TEXT_ASSET_BYTES = 16 * 1024 ** 2;

export const AssetSchema = z.object({ sha256: Sha256Schema, mime: AssetMimeSchema, size: z.number().int() });
export type Asset = z.infer<typeof AssetSchema>;

export const MemexGcResultSchema = z.object({ assets: z.number().int(), strays: z.number().int(), tmp: z.number().int() });
export type MemexGcResult = z.infer<typeof MemexGcResultSchema>;
