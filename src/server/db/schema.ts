// drizzle table definitions for every module. Workflow: edit this file,
// `pnpm db:generate`, read the SQL it wrote to drizzle/, commit both.
// (Split into one file per area when it grows.)

import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Scene } from "../../shared/notes.ts";
import type { Doc } from "../../shared/notes-doc.ts";
import type { PageDoc } from "../../shared/memex-doc.ts";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });


// Immutable bytes, stored on disk by sha256 (see src/server/node/blob-store.ts).
export const archiveBlobs = pgTable("archive_blobs", {
  sha256: text("sha256").primaryKey(),
  size: bigint("size", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  // Last time these bytes were uploaded: the GC grace period counts from here.
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const archiveEntries = pgTable(
  "archive_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    type: text("type").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    // Text extracted from the files (a type's `searchText`), indexed for search; never returned by the API.
    searchText: text("search_text"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // Punctuation becomes spaces so "report.pdf" and URLs split into words. The text is capped
    // because a tsvector can't exceed 1 MB.
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', regexp_replace(title || ' ' || coalesce(source_url, '') || ' ' || left(coalesce(search_text, ''), 200000), '[^[:alnum:]]+', ' ', 'g'))`,
    ),
  },
  (t) => [index("archive_entries_search_idx").using("gin", t.search), index("archive_entries_type_idx").on(t.type, t.id.desc())],
);

export const archiveFiles = pgTable(
  "archive_files",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => archiveEntries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    mime: text("mime").notNull(),
    sha256: text("sha256")
      .notNull()
      .references(() => archiveBlobs.sha256),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.name] }), index("archive_files_sha256_idx").on(t.sha256)],
);

export const archiveTags = pgTable(
  "archive_tags",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => archiveEntries.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tag] }), index("archive_tags_tag_idx").on(t.tag)],
);

// "module X, item Y uses entry Z". RESTRICT: Postgres itself refuses to delete
// a referenced entry, so an app bug can't break a reference.
export const archiveRefs = pgTable(
  "archive_refs",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => archiveEntries.id, { onDelete: "restrict" }),
    module: text("module").notNull(),
    itemId: text("item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.module, t.itemId] })],
);

export const archiveSearches = pgTable("archive_searches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  query: text("query").notNull(),
  type: text("type"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// Asynchronous additions (types added through POST /archive/jobs, e.g. video). Queued jobs run one at a
// time, oldest `queued_at` first; the entry is created when a job finishes.
export const archiveJobs = pgTable(
  "archive_jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    type: text("type").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    // Where the job fetches from (the URL), to refuse a second job for the same thing.
    sourceUrl: text("source_url"),
    title: text("title"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("queued"), // queued | running | done | failed | cancelled
    stage: text("stage"), // download | encode | import
    progress: real("progress"),
    detail: text("detail"),
    logTail: text("log_tail").notNull().default(""),
    error: text("error"),
    entryId: uuid("entry_id").references(() => archiveEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // When it last entered the queue (a retry queues it again at the back).
    queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("archive_jobs_status_idx").on(t.status, t.queuedAt)],
);

// Notes (design: ideas/notes.md). Pages are editable; everything below the page row is rebuilt
// from its doc on every save (src/shared/notes-doc.ts analyzeDoc), in the same transaction.
export const notesPages = pgTable(
  "notes_pages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    // ProseMirror JSON (Tiptap's getJSON()).
    doc: jsonb("doc").$type<Doc>().notNull(),
    // Plain text of the doc, for search and snippets.
    text: text("text").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // Same recipe as archive_entries.search.
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', regexp_replace(title || ' ' || left(text, 200000), '[^[:alnum:]]+', ' ', 'g'))`,
    ),
  },
  (t) => [index("notes_pages_search_idx").using("gin", t.search), index("notes_pages_updated_idx").on(t.updatedAt.desc(), t.id.desc())],
);

// Separate from archive_tags: notes and the archive tag their own things.
export const notesTags = pgTable(
  "notes_tags",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => notesPages.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tag] }), index("notes_tags_tag_idx").on(t.tag)],
);

// The blocks of each page that have an id: what (( links search and point at. Block ids are only
// unique within a page (a pasted block keeps its id), so links name the page too.
export const notesBlocks = pgTable(
  "notes_blocks",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => notesPages.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.blockId] })],
);

// Links from a page (and the block holding the link) to a page or one of its blocks. No foreign
// key on the target: a link to a deleted page stays, and shows as broken.
export const notesLinks = pgTable(
  "notes_links",
  {
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => notesPages.id, { onDelete: "cascade" }),
    fromBlockId: text("from_block_id"),
    toPageId: uuid("to_page_id").notNull(),
    toBlockId: text("to_block_id"),
  },
  (t) => [index("notes_links_from_idx").on(t.fromPageId), index("notes_links_to_idx").on(t.toPageId)],
);

// Excalidraw scenes, saved on their own so a stroke doesn't re-save the page. A page's doc holds
// only the drawing's id. A drawing no page shows gets detached_at, and the hourly sweep
// (src/server/notes/gc.ts) deletes it a day later (so undoing a deletion still finds it).
export const notesDrawings = pgTable("notes_drawings", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  scene: jsonb("scene").$type<Scene>().notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  detachedAt: timestamp("detached_at", { withTimezone: true, mode: "date" }).defaultNow(),
});

export const notesPageDrawings = pgTable(
  "notes_page_drawings",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => notesPages.id, { onDelete: "cascade" }),
    drawingId: uuid("drawing_id")
      .notNull()
      .references(() => notesDrawings.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.drawingId] }), index("notes_page_drawings_drawing_idx").on(t.drawingId)],
);

// Memex: printable pages (design: ideas/printable.md). Its own tables and its own asset store
// ($STATE_DIRECTORY/memex/); nothing here touches the archive. memex_page_assets is rebuilt from
// the doc on every save (src/shared/memex-doc.ts analyzePageDoc), in the same transaction.
export const memexPages = pgTable(
  "memex_pages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    doc: jsonb("doc").$type<PageDoc>().notNull(),
    // Text of the page's text boxes, for search and snippets.
    text: text("text").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // Same recipe as notes_pages.search.
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', regexp_replace(title || ' ' || left(text, 200000), '[^[:alnum:]]+', ' ', 'g'))`,
    ),
  },
  (t) => [index("memex_pages_search_idx").using("gin", t.search), index("memex_pages_updated_idx").on(t.updatedAt.desc(), t.id.desc())],
);

export const memexTags = pgTable(
  "memex_tags",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => memexPages.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tag] }), index("memex_tags_tag_idx").on(t.tag)],
);

// Uploaded files, stored by sha256 in the memex blob store. The server sets `mime` from the bytes.
// An asset no page uses has detached_at (an upload starts that way); the hourly sweep
// (src/server/memex/gc.ts) deletes it a day later, so undoing a deletion still finds it.
export const memexAssets = pgTable("memex_assets", {
  sha256: text("sha256").primaryKey(),
  mime: text("mime").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  detachedAt: timestamp("detached_at", { withTimezone: true, mode: "date" }).defaultNow(),
});

export const memexPageAssets = pgTable(
  "memex_page_assets",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => memexPages.id, { onDelete: "cascade" }),
    sha256: text("sha256")
      .notNull()
      .references(() => memexAssets.sha256, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.sha256] }), index("memex_page_assets_sha256_idx").on(t.sha256)],
);
