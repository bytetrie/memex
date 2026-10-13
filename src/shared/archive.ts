// Archive API shapes shared by server and web (see ideas/archive.md).
// The DB row shape is allowed to differ; the repo maps rows to these.

import { z } from "zod";
import { ArchiveTypeIdSchema, FileNameSchema, MimeSchema, Sha256Schema } from "./archive-types.ts";
import { ModuleIdSchema } from "./api.ts";

export const FileRoleSchema = z.enum(["original", "derived", "metadata", "thumbnail"]);
export type FileRole = z.infer<typeof FileRoleSchema>;

export const TagSchema = z.string().trim().toLowerCase().min(1).max(64);
export const TagsSchema = z.array(TagSchema).max(50);

export const BlobSchema = z.object({ sha256: Sha256Schema, size: z.number().int().nonnegative() });
export type Blob = z.infer<typeof BlobSchema>;

export const ArchiveFileSchema = z.object({
  name: FileNameSchema,
  role: FileRoleSchema,
  mime: MimeSchema,
  sha256: Sha256Schema,
  size: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type ArchiveFile = z.infer<typeof ArchiveFileSchema>;

export const ArchiveRefSchema = z.object({
  module: ModuleIdSchema,
  itemId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
});
export type ArchiveRef = z.infer<typeof ArchiveRefSchema>;

export const EntrySummarySchema = z.object({
  id: z.uuid(),
  type: ArchiveTypeIdSchema,
  title: z.string(),
  sourceUrl: z.string().nullable(),
  tags: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  // The entry's files with role "thumbnail", so a list can show images without loading the entry.
  thumbnails: z.array(z.object({ name: FileNameSchema, mime: MimeSchema })),
  createdAt: z.iso.datetime(),
});
export type EntrySummary = z.infer<typeof EntrySummarySchema>;

export const EntrySchema = EntrySummarySchema.extend({
  meta: z.record(z.string(), z.unknown()),
  files: z.array(ArchiveFileSchema),
  refs: z.array(ArchiveRefSchema),
});
export type Entry = z.infer<typeof EntrySchema>;

export const EntryListSchema = z.object({
  items: z.array(EntrySummarySchema),
  nextCursor: z.string().nullable(),
});
export type EntryList = z.infer<typeof EntryListSchema>;

export const ListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Words (prefix match, all required) and #tags (all required): "report #work #2026". Quote a tag with spaces: #"my tag".'),
  type: ArchiveTypeIdSchema.optional(),
  tag: TagSchema.optional().describe("One more tag that must be on the entry (same as #tag in q)."),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.uuid().optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const ArchiveTypeInfoSchema = z.object({
  id: ArchiveTypeIdSchema,
  label: z.string(),
  // "entry": add with POST /archive/entries. "job": add with POST /archive/jobs (fetched and processed
  // in the background; poll the job).
  mode: z.enum(["entry", "job"]),
  // JSON Schema of the type's `input`, for agents building a POST /archive/entries body.
  inputSchema: z.record(z.string(), z.unknown()),
});
export type ArchiveTypeInfo = z.infer<typeof ArchiveTypeInfoSchema>;

// `input` is validated against the chosen type's schema (src/shared/archive-types.ts).
export const CreateEntrySchema = z.object({
  type: ArchiveTypeIdSchema,
  title: z.string().trim().min(1).max(300).optional(),
  tags: TagsSchema.optional(),
  input: z.unknown(),
});
export type CreateEntry = z.infer<typeof CreateEntrySchema>;

export const PatchEntrySchema = z
  .object({ title: z.string().trim().min(1).max(300), tags: TagsSchema })
  .partial()
  .refine((p) => p.title !== undefined || p.tags !== undefined, "nothing to change");
export type PatchEntry = z.infer<typeof PatchEntrySchema>;

export const RecordSearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  type: ArchiveTypeIdSchema.optional(),
});
export type RecordSearch = z.infer<typeof RecordSearchSchema>;

// Identifies a recent search to remove: the same query and type the list shows (no type = "all types").
export const SearchKeySchema = z.object({ query: z.string().min(1).max(200), type: ArchiveTypeIdSchema.optional() });

export const RecentSearchSchema = z.object({
  query: z.string(),
  type: ArchiveTypeIdSchema.nullable(),
  lastAt: z.iso.datetime(),
});
export const RecentSearchesSchema = z.object({ items: z.array(RecentSearchSchema) });
export type RecentSearches = z.infer<typeof RecentSearchesSchema>;

export const GcQuerySchema = z.object({ graceHours: z.coerce.number().min(0).max(8760).default(24) });

export const GcResultSchema = z.object({
  blobs: z.array(Sha256Schema), // unreferenced blobs removed
  strays: z.array(Sha256Schema), // store files that had no blob row, removed
  tmp: z.number().int().nonnegative(), // stale upload temp files removed
  incoming: z.number().int().nonnegative(), // stale runner job folders removed
  jobs: z.number().int().nonnegative(), // finished jobs older than a week removed
});
export type GcResult = z.infer<typeof GcResultSchema>;

// 409 body when an entry is still referenced.
export const ReferencedSchema = z.object({ error: z.string(), refs: z.array(ArchiveRefSchema) });
export const ErrorSchema = z.object({ error: z.string() });
