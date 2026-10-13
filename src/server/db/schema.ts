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
