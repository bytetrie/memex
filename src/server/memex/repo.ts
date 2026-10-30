// The memex's queries (drizzle). Implements MemexRepo from ports.ts; only server.ts and tests
// import this file, so app.ts stays free of the DB driver.

import { and, desc, eq, exists, inArray, isNotNull, lt, notExists, sql, type SQL } from "drizzle-orm";
import { analyzePageDoc, defaultFormat, type PageDoc } from "../../shared/memex-doc.ts";
import { AssetMimeSchema, type Asset, type MemexPage, type MemexPageSummary } from "../../shared/memex.ts";
import type { Db, Tx } from "../db/client.ts";
import { iso, single, uniqueSorted } from "../db/pg.ts";
import { memexAssets, memexPageAssets, memexPages, memexTags } from "../db/schema.ts";
import { parseSearch, toTsQuery } from "../search.ts";
import { MemexError, type MemexRepo } from "./ports.ts";

const SNIPPET = 160;
const UNTITLED = "Untitled";

// A list cursor: the last page's updated_at in microseconds since 1970 and its id (as in notes).
const CURSOR = /^(\d{1,20})_([0-9a-f-]{36})$/;
const updatedMicros = sql<string>`(extract(epoch from ${memexPages.updatedAt}) * 1000000)::bigint::text`;

const assetOf = (row: typeof memexAssets.$inferSelect): Asset => ({ sha256: row.sha256, mime: AssetMimeSchema.parse(row.mime), size: row.size });

// Assets among `shas` that no page uses any more get detached_at (the sweep deletes them later).
async function detachUnused(tx: Tx, shas: string[]): Promise<void> {
  if (shas.length === 0) return;
  await tx
    .update(memexAssets)
    .set({ detachedAt: sql`now()` })
    .where(and(inArray(memexAssets.sha256, shas), notExists(tx.select({ x: sql`1` }).from(memexPageAssets).where(eq(memexPageAssets.sha256, memexAssets.sha256)))));
}

// Rebuilds the page's asset uses from its doc. Runs in the transaction that wrote the doc.
async function indexAssets(tx: Tx, pageId: string, assets: string[]): Promise<void> {
  const before = (await tx.select({ sha256: memexPageAssets.sha256 }).from(memexPageAssets).where(eq(memexPageAssets.pageId, pageId))).map((r) => r.sha256);
  await tx.delete(memexPageAssets).where(eq(memexPageAssets.pageId, pageId));
  // Only assets that exist: one swept since the page last used it is gone for good.
  const used = assets.length ? (await tx.select({ sha256: memexAssets.sha256 }).from(memexAssets).where(inArray(memexAssets.sha256, assets))).map((r) => r.sha256) : [];
  if (used.length) {
    await tx.insert(memexPageAssets).values(used.map((sha256) => ({ pageId, sha256 })));
    await tx.update(memexAssets).set({ detachedAt: null }).where(inArray(memexAssets.sha256, used));
  }
  await detachUnused(tx, before.filter((s) => !used.includes(s)));
}

export function createMemexRepo(db: Db): MemexRepo {
  const tagsOf = async (ids: string[]) => {
    const rows = ids.length ? await db.select().from(memexTags).where(inArray(memexTags.pageId, ids)).orderBy(memexTags.tag) : [];
    return (id: string) => rows.filter((r) => r.pageId === id).map((r) => r.tag);
  };

  async function getPage(id: string): Promise<MemexPage | null> {
    const [row] = await db.select().from(memexPages).where(eq(memexPages.id, id));
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      tags: (await tagsOf([id]))(id),
      doc: row.doc,
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  const mustGet = async (id: string) => {
    const page = await getPage(id);
    if (!page) throw new MemexError("not_found", "page not found");
    return page;
  };

  return {
    async createPage({ title, tags, doc }) {
      const analysis = analyzePageDoc(doc);
      const id = await db.transaction(async (tx) => {
        const row = single(await tx.insert(memexPages).values({ title: title || UNTITLED, doc, text: analysis.text }).returning({ id: memexPages.id }));
        const unique = uniqueSorted(tags);
        if (unique.length) await tx.insert(memexTags).values(unique.map((tag) => ({ pageId: row.id, tag })));
        await indexAssets(tx, row.id, analysis.assets);
        return row.id;
      });
      return mustGet(id);
    },

    getPage,

    async listPages({ q, tag, limit, cursor }) {
      const conds: (SQL | undefined)[] = [];
      const parsed = q ? parseSearch(q) : { words: "", tags: [] };
      const tags = [...new Set([...parsed.tags, ...(tag ? [tag] : [])])];
      if (q) {
        const tsquery = toTsQuery(parsed.words);
        if (tsquery) conds.push(sql`${memexPages.search} @@ to_tsquery('simple', ${tsquery})`);
        else if (tags.length === 0) return { items: [], nextCursor: null };
      }
      for (const t of tags) {
        conds.push(exists(db.select({ x: sql`1` }).from(memexTags).where(and(eq(memexTags.pageId, memexPages.id), eq(memexTags.tag, t)))));
      }
      if (cursor) {
        const m = CURSOR.exec(cursor);
        if (!m) return { items: [], nextCursor: null };
        conds.push(sql`(${memexPages.updatedAt}, ${memexPages.id}) < (timestamptz 'epoch' + ${m[1]}::bigint * interval '1 microsecond', ${m[2]}::uuid)`);
      }
      const rows = await db
        .select({
          id: memexPages.id,
          title: memexPages.title,
          format: sql<PageDoc["format"] | null>`${memexPages.doc} -> 'format'`,
          snippet: sql<string>`left(${memexPages.text}, ${SNIPPET})`,
          updatedAt: memexPages.updatedAt,
          at: updatedMicros,
        })
        .from(memexPages)
        .where(and(...conds))
        .orderBy(desc(memexPages.updatedAt), desc(memexPages.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const tagged = await tagsOf(page.map((r) => r.id));
      const items = page.map(
        (r): MemexPageSummary => ({ id: r.id, title: r.title, tags: tagged(r.id), format: r.format ?? defaultFormat(), snippet: r.snippet, updatedAt: iso(r.updatedAt) }),
      );
      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last ? `${last.at}_${last.id}` : null };
    },

    async savePage(id, { title, doc, baseVersion }) {
      const analysis = analyzePageDoc(doc);
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(memexPages)
          .set({ title: title || UNTITLED, doc, text: analysis.text, version: sql`${memexPages.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(memexPages.id, id), eq(memexPages.version, baseVersion)))
          .returning({ version: memexPages.version, updatedAt: memexPages.updatedAt });
        if (!row) return null;
        await indexAssets(tx, id, analysis.assets);
        return { version: row.version, updatedAt: iso(row.updatedAt) };
      });
      if (saved) return saved;
      const [current] = await db.select({ version: memexPages.version }).from(memexPages).where(eq(memexPages.id, id));
      if (!current) throw new MemexError("not_found", "page not found");
      throw new MemexError("version_conflict", "the page was saved elsewhere since this version", current.version);
    },

    async setTags(id, tags) {
      const found = await db.transaction(async (tx) => {
        const [row] = await tx.select({ id: memexPages.id }).from(memexPages).where(eq(memexPages.id, id)).for("update");
        if (!row) return false;
        await tx.delete(memexTags).where(eq(memexTags.pageId, id));
        const unique = uniqueSorted(tags);
        if (unique.length) await tx.insert(memexTags).values(unique.map((tag) => ({ pageId: id, tag })));
        return true;
      });
      return found ? getPage(id) : null;
    },

    async deletePage(id) {
      return db.transaction(async (tx) => {
        const assets = (await tx.select({ sha256: memexPageAssets.sha256 }).from(memexPageAssets).where(eq(memexPageAssets.pageId, id))).map((r) => r.sha256);
        const rows = await tx.delete(memexPages).where(eq(memexPages.id, id)).returning({ id: memexPages.id });
        if (rows.length === 0) return false;
        await detachUnused(tx, assets);
        return true;
      });
    },

    async tagCounts() {
      const count = sql<number>`count(*)::int`;
      return db.select({ tag: memexTags.tag, count }).from(memexTags).groupBy(memexTags.tag).orderBy(memexTags.tag);
    },

    async registerAsset({ sha256, mime, size }) {
      const row = single(
        await db
          .insert(memexAssets)
          .values({ sha256, mime, size })
          .onConflictDoUpdate({
            target: memexAssets.sha256,
            // Still detached: the new upload is about to be used, so its day starts now.
            set: { detachedAt: sql`case when ${memexAssets.detachedAt} is null then null else now() end` },
          })
          .returning(),
      );
      return assetOf(row);
    },

    async getAsset(sha256) {
      const [row] = await db.select().from(memexAssets).where(eq(memexAssets.sha256, sha256));
      return row ? assetOf(row) : null;
    },

    async existingAssets(shas) {
      if (shas.length === 0) return new Set();
      const rows = await db.select({ sha256: memexAssets.sha256 }).from(memexAssets).where(inArray(memexAssets.sha256, shas));
      return new Set(rows.map((r) => r.sha256));
    },

    async deleteDetachedAssets(before) {
      const rows = await db
        .delete(memexAssets)
        .where(
          and(
            isNotNull(memexAssets.detachedAt),
            lt(memexAssets.detachedAt, before),
            notExists(db.select({ x: sql`1` }).from(memexPageAssets).where(eq(memexPageAssets.sha256, memexAssets.sha256))),
          ),
        )
        .returning({ sha256: memexAssets.sha256 });
      return rows.map((r) => r.sha256);
    },
  };
}
