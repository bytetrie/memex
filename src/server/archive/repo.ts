// The archive's queries (drizzle). Implements ArchiveRepo from ports.ts; only
// server.ts and tests import this file, so app.ts stays free of the DB driver.

import { and, desc, eq, exists, inArray, isNull, lt, lte, notExists, notInArray, sql, type SQL } from "drizzle-orm";
// Enum columns are plain text in Postgres; their values are parsed on the way out.
import { ModuleIdSchema } from "../../shared/api.ts";
import { FileRoleSchema, type ArchiveFile, type ArchiveRef, type Entry, type EntrySummary } from "../../shared/archive.ts";
import { ArchiveTypeIdSchema } from "../../shared/archive-types.ts";
import type { Db, Tx } from "../db/client.ts";
import { FOREIGN_KEY, iso, pgCode, single, UNIQUE, uniqueSorted } from "../db/pg.ts";
import { archiveBlobs, archiveEntries, archiveFiles, archiveRefs, archiveSearches, archiveTags } from "../db/schema.ts";
import { ArchiveError, type ArchiveRepo, type NewFile } from "./ports.ts";
import { parseSearch, toTsQuery } from "../search.ts";

export function createArchiveRepo(db: Db): ArchiveRepo {
  const refsOf = async (id: string): Promise<ArchiveRef[]> =>
    (await db.select().from(archiveRefs).where(eq(archiveRefs.entryId, id)).orderBy(archiveRefs.module, archiveRefs.itemId)).map((r) => ({
      module: ModuleIdSchema.parse(r.module),
      itemId: r.itemId,
      createdAt: iso(r.createdAt),
    }));

  async function summaries(rows: { id: string; type: string; title: string; sourceUrl: string | null; createdAt: Date }[]): Promise<EntrySummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const tagRows = await db.select().from(archiveTags).where(inArray(archiveTags.entryId, ids)).orderBy(archiveTags.tag);
    const countRows = await db
      .select({ entryId: archiveFiles.entryId, n: sql<number>`count(*)::int` })
      .from(archiveFiles)
      .where(inArray(archiveFiles.entryId, ids))
      .groupBy(archiveFiles.entryId);
    const thumbRows = await db
      .select({ entryId: archiveFiles.entryId, name: archiveFiles.name, mime: archiveFiles.mime })
      .from(archiveFiles)
      .where(and(inArray(archiveFiles.entryId, ids), eq(archiveFiles.role, "thumbnail")))
      .orderBy(archiveFiles.name);
    return rows.map((r) => ({
      id: r.id,
      type: ArchiveTypeIdSchema.parse(r.type),
      title: r.title,
      sourceUrl: r.sourceUrl,
      tags: tagRows.filter((t) => t.entryId === r.id).map((t) => t.tag),
      fileCount: countRows.find((c) => c.entryId === r.id)?.n ?? 0,
      thumbnails: thumbRows.filter((t) => t.entryId === r.id).map(({ name, mime }) => ({ name, mime })),
      createdAt: iso(r.createdAt),
    }));
  }

  async function getEntry(id: string): Promise<Entry | null> {
    const [row] = await db
      .select({
        id: archiveEntries.id,
        type: archiveEntries.type,
        title: archiveEntries.title,
        sourceUrl: archiveEntries.sourceUrl,
        meta: archiveEntries.meta,
        createdAt: archiveEntries.createdAt,
      })
      .from(archiveEntries)
      .where(eq(archiveEntries.id, id));
    if (!row) return null;
    const summary = single(await summaries([row]));
    const files = await db
      .select({
        name: archiveFiles.name,
        role: archiveFiles.role,
        mime: archiveFiles.mime,
        sha256: archiveFiles.sha256,
        size: archiveBlobs.size,
        createdAt: archiveFiles.createdAt,
      })
      .from(archiveFiles)
      .innerJoin(archiveBlobs, eq(archiveBlobs.sha256, archiveFiles.sha256))
      .where(eq(archiveFiles.entryId, id))
      .orderBy(archiveFiles.name);
    return {
      ...summary,
      meta: row.meta,
      files: files.map((f): ArchiveFile => ({ ...f, role: FileRoleSchema.parse(f.role), createdAt: iso(f.createdAt) })),
      refs: await refsOf(id),
    };
  }

  const fileRows = (entryId: string, files: NewFile[]) => files.map((f) => ({ entryId, name: f.name, role: f.role, mime: f.mime, sha256: f.sha256 }));

  const mustGet = async (id: string) => {
    const entry = await getEntry(id);
    if (!entry) throw new ArchiveError("not_found", "entry not found");
    return entry;
  };

  return {
    async registerBlob({ sha256, size }) {
      await db
        .insert(archiveBlobs)
        .values({ sha256, size })
        .onConflictDoUpdate({ target: archiveBlobs.sha256, set: { uploadedAt: sql`now()` } });
    },

    async existingBlobs(shas) {
      if (shas.length === 0) return new Set();
      const rows = await db.select({ sha256: archiveBlobs.sha256 }).from(archiveBlobs).where(inArray(archiveBlobs.sha256, shas));
      return new Set(rows.map((r) => r.sha256));
    },

    async createEntry(entry) {
      let id: string;
      try {
        id = await db.transaction(async (tx) => {
          const row = single(
            await tx
              .insert(archiveEntries)
              .values({ type: entry.type, title: entry.title, sourceUrl: entry.sourceUrl ?? null, meta: entry.meta ?? {}, searchText: entry.searchText ?? null })
              .returning({ id: archiveEntries.id }),
          );
          await tx.insert(archiveFiles).values(fileRows(row.id, entry.files));
          const tags = uniqueSorted(entry.tags ?? []);
          if (tags.length) await tx.insert(archiveTags).values(tags.map((tag) => ({ entryId: row.id, tag })));
          return row.id;
        });
      } catch (err) {
        if (pgCode(err) === FOREIGN_KEY) throw new ArchiveError("unknown_blob", "a file refers to a blob that was not uploaded");
        if (pgCode(err) === UNIQUE) throw new ArchiveError("conflict", "duplicate file name");
        throw err;
      }
      return mustGet(id);
    },

    getEntry,

    async listEntries({ q, type, tag, limit, cursor }) {
      const conds: (SQL | undefined)[] = [];
      // `q` holds words and #tags; the `tag` parameter is one more tag. Every tag must be on the entry.
      const parsed = q ? parseSearch(q) : { words: "", tags: [] };
      const tags = [...new Set([...parsed.tags, ...(tag ? [tag] : [])])];
      if (q) {
        const tsquery = toTsQuery(parsed.words);
        if (tsquery) conds.push(sql`${archiveEntries.search} @@ to_tsquery('simple', ${tsquery})`);
        else if (tags.length === 0) return { items: [], nextCursor: null }; // nothing searchable in q
      }
      if (type) conds.push(eq(archiveEntries.type, type));
      for (const t of tags) {
        conds.push(exists(db.select({ x: sql`1` }).from(archiveTags).where(and(eq(archiveTags.entryId, archiveEntries.id), eq(archiveTags.tag, t)))));
      }
      // ids are uuidv7, so id order is creation order and the last id is a cursor.
      if (cursor) conds.push(lt(archiveEntries.id, cursor));
      const rows = await db
        .select({
          id: archiveEntries.id,
          type: archiveEntries.type,
          title: archiveEntries.title,
          sourceUrl: archiveEntries.sourceUrl,
          createdAt: archiveEntries.createdAt,
        })
        .from(archiveEntries)
        .where(and(...conds))
        .orderBy(desc(archiveEntries.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { items: await summaries(page), nextCursor: rows.length > limit && last ? last.id : null };
    },

    async updateEntry(id, patch) {
      await db.transaction(async (tx) => {
        if (patch.title !== undefined) await tx.update(archiveEntries).set({ title: patch.title }).where(eq(archiveEntries.id, id));
        if (patch.tags !== undefined) {
          const tags = uniqueSorted(patch.tags);
          await tx.delete(archiveTags).where(eq(archiveTags.entryId, id));
          if (tags.length) await tx.insert(archiveTags).values(tags.map((tag) => ({ entryId: id, tag }))).onConflictDoNothing();
        }
      });
      return getEntry(id);
    },

    async deleteEntry(id) {
      const refs = await refsOf(id);
      if (refs.length) throw new ArchiveError("referenced", "entry is still in use", refs);
      // Timestamps travel as text: JS dates would cut Postgres's microseconds off the comparison below.
      let attached: { sha256: string; at: string }[];
      try {
        attached = await db.transaction(async (tx) => {
          const files = await tx
            .select({ sha256: archiveFiles.sha256, at: sql<string>`${archiveFiles.createdAt}::text` })
            .from(archiveFiles)
            .where(eq(archiveFiles.entryId, id));
          const rows = await tx.delete(archiveEntries).where(eq(archiveEntries.id, id)).returning({ id: archiveEntries.id });
          if (rows.length === 0) throw new ArchiveError("not_found", "entry not found");
          return files;
        });
      } catch (err) {
        // A ref appeared between the check and the delete: Postgres refused (ON DELETE RESTRICT).
        if (pgCode(err) === FOREIGN_KEY) throw new ArchiveError("referenced", "entry is still in use", await refsOf(id));
        throw err;
      }
      // Free the bytes now unless another entry uses them or they were uploaded again after being
      // attached (a new entry may be about to use them: the gc handles those after its grace period).
      const freed: string[] = [];
      for (const { sha256, at } of attached) {
        try {
          const rows = await db
            .delete(archiveBlobs)
            .where(
              and(
                eq(archiveBlobs.sha256, sha256),
                lte(archiveBlobs.uploadedAt, sql`${at}::timestamptz`),
                notExists(db.select({ x: sql`1` }).from(archiveFiles).where(eq(archiveFiles.sha256, archiveBlobs.sha256))),
              ),
            )
            .returning({ sha256: archiveBlobs.sha256 });
          if (rows.length) freed.push(sha256);
        } catch (err) {
          if (pgCode(err) !== FOREIGN_KEY) throw err; // an entry started using it meanwhile
        }
      }
      return freed;
    },

    async getFile(id, name) {
      const [row] = await db
        .select({ sha256: archiveFiles.sha256, size: archiveBlobs.size, mime: archiveFiles.mime, role: archiveFiles.role })
        .from(archiveFiles)
        .innerJoin(archiveBlobs, eq(archiveBlobs.sha256, archiveFiles.sha256))
        .where(and(eq(archiveFiles.entryId, id), eq(archiveFiles.name, name)));
      return row ? { ...row, role: FileRoleSchema.parse(row.role) } : null;
    },

    async findBySource(type, url) {
      const [row] = await db
        .select({ id: archiveEntries.id })
        .from(archiveEntries)
        .where(and(eq(archiveEntries.type, type), eq(archiveEntries.sourceUrl, url)))
        .orderBy(desc(archiveEntries.id))
        .limit(1);
      return row?.id ?? null;
    },

    async putRef(id, module, itemId) {
      try {
        await db.insert(archiveRefs).values({ entryId: id, module, itemId }).onConflictDoNothing();
      } catch (err) {
        if (pgCode(err) === FOREIGN_KEY) throw new ArchiveError("not_found", "entry not found");
        throw err;
      }
      const row = single(
        await db
          .select()
          .from(archiveRefs)
          .where(and(eq(archiveRefs.entryId, id), eq(archiveRefs.module, module), eq(archiveRefs.itemId, itemId))),
      );
      return { module, itemId, createdAt: iso(row.createdAt) };
    },

    async deleteRef(id, module, itemId) {
      const rows = await db
        .delete(archiveRefs)
        .where(and(eq(archiveRefs.entryId, id), eq(archiveRefs.module, module), eq(archiveRefs.itemId, itemId)))
        .returning({ id: archiveRefs.entryId });
      return rows.length > 0;
    },

    async recordSearch({ query, type }) {
      await db.insert(archiveSearches).values({ query, type: type ?? null });
    },

    async deleteSearch({ query, type }) {
      await db.delete(archiveSearches).where(and(eq(archiveSearches.query, query), type ? eq(archiveSearches.type, type) : isNull(archiveSearches.type)));
    },

    async recentSearches(limit) {
      const lastAt = sql<Date>`max(${archiveSearches.createdAt})`;
      const rows = await db
        .select({ query: archiveSearches.query, type: archiveSearches.type, lastAt })
        .from(archiveSearches)
        .groupBy(archiveSearches.query, archiveSearches.type)
        .orderBy(desc(lastAt))
        .limit(limit);
      return { items: rows.map((r) => ({ query: r.query, type: ArchiveTypeIdSchema.nullable().parse(r.type), lastAt: iso(new Date(r.lastAt)) })) };
    },

    async orphanBlobs(uploadedBefore) {
      const rows = await db
        .select({ sha256: archiveBlobs.sha256 })
        .from(archiveBlobs)
        .where(and(lt(archiveBlobs.uploadedAt, uploadedBefore), notExists(db.select({ x: sql`1` }).from(archiveFiles).where(eq(archiveFiles.sha256, archiveBlobs.sha256)))))
        .limit(1000);
      return rows.map((r) => r.sha256);
    },

    async deleteBlobIfUnreferenced(sha256) {
      try {
        const rows = await db.delete(archiveBlobs).where(eq(archiveBlobs.sha256, sha256)).returning({ sha256: archiveBlobs.sha256 });
        return rows.length > 0;
      } catch (err) {
        if (pgCode(err) === FOREIGN_KEY) return false; // referenced after all
        throw err;
      }
    },
  };
}

// Makes `entryIds` the exact set of entries that a module's item uses, inside the caller's
// transaction (notes call it when a page is saved or deleted). Ids of entries that don't exist
// (deleted since the item started showing them) are skipped; FOR KEY SHARE keeps the others from
// being deleted until the transaction ends. Returns the ids that got a ref.
export async function setRefs(tx: Tx, module: ArchiveRef["module"], itemId: string, entryIds: string[]): Promise<string[]> {
  const ids = [...new Set(entryIds)];
  const existing = ids.length
    ? (await tx.select({ id: archiveEntries.id }).from(archiveEntries).where(inArray(archiveEntries.id, ids)).for("key share")).map((r) => r.id)
    : [];
  const keep = and(eq(archiveRefs.module, module), eq(archiveRefs.itemId, itemId));
  await tx.delete(archiveRefs).where(existing.length ? and(keep, notInArray(archiveRefs.entryId, existing)) : keep);
  if (existing.length) await tx.insert(archiveRefs).values(existing.map((entryId) => ({ entryId, module, itemId }))).onConflictDoNothing();
  return existing;
}
