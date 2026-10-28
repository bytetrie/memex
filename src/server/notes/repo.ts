// Notes' queries (drizzle). Implements NotesRepo from ports.ts; only server.ts and tests import
// this file, so app.ts stays free of the DB driver.

import { and, desc, eq, exists, ilike, inArray, isNotNull, lt, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { analyzeDoc, type DocAnalysis } from "../../shared/notes-doc.ts";
import type { Backlink, Drawing, Page, PageSummary } from "../../shared/notes.ts";
import { setRefs } from "../archive/repo.ts";
import type { Db, Tx } from "../db/client.ts";
import { iso, single, uniqueSorted } from "../db/pg.ts";
import { notesBlocks, notesDrawings, notesLinks, notesPageDrawings, notesPages, notesTags } from "../db/schema.ts";
import { parseSearch, toTsQuery } from "../search.ts";
import { NotesError, type NotesRepo } from "./ports.ts";

const MODULE = "notes";
const SNIPPET = 160;
const UNTITLED = "Untitled";
// Rows per INSERT: Postgres takes at most 65535 parameters per statement.
const CHUNK = 1000;

// A list cursor: the last page's updated_at in microseconds since 1970 (exact, unlike a JS date) and id.
const CURSOR = /^(\d{1,20})_([0-9a-f-]{36})$/;
const updatedMicros = sql<string>`(extract(epoch from ${notesPages.updatedAt}) * 1000000)::bigint::text`;

const chunks = <T>(rows: T[]): T[][] => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

// Escapes LIKE's wildcards in a user's word.
const likeWord = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Drawings among `ids` that no page shows any more get detached_at (the sweep deletes them later).
async function detachUnused(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(notesDrawings)
    .set({ detachedAt: sql`now()` })
    .where(and(inArray(notesDrawings.id, ids), notExists(tx.select({ x: sql`1` }).from(notesPageDrawings).where(eq(notesPageDrawings.drawingId, notesDrawings.id)))));
}

// Rebuilds everything derived from a page's doc. Runs in the transaction that wrote the doc.
async function indexDoc(tx: Tx, pageId: string, a: DocAnalysis): Promise<void> {
  await tx.delete(notesBlocks).where(eq(notesBlocks.pageId, pageId));
  for (const rows of chunks(a.blocks.map((b) => ({ pageId, blockId: b.id, type: b.type, text: b.text, position: b.position })))) {
    await tx.insert(notesBlocks).values(rows);
  }

  await tx.delete(notesLinks).where(eq(notesLinks.fromPageId, pageId));
  for (const rows of chunks(a.links.map((l) => ({ fromPageId: pageId, ...l })))) await tx.insert(notesLinks).values(rows);

  const before = (await tx.select({ id: notesPageDrawings.drawingId }).from(notesPageDrawings).where(eq(notesPageDrawings.pageId, pageId))).map((r) => r.id);
  await tx.delete(notesPageDrawings).where(eq(notesPageDrawings.pageId, pageId));
  // Only drawings that exist: one swept since the page last showed it is gone for good.
  const shown = a.drawingIds.length
    ? (await tx.select({ id: notesDrawings.id }).from(notesDrawings).where(inArray(notesDrawings.id, a.drawingIds))).map((r) => r.id)
    : [];
  if (shown.length) {
    await tx.insert(notesPageDrawings).values(shown.map((drawingId) => ({ pageId, drawingId })));
    await tx.update(notesDrawings).set({ detachedAt: null }).where(inArray(notesDrawings.id, shown));
  }
  await detachUnused(tx, before.filter((id) => !shown.includes(id)));

  await setRefs(tx, MODULE, pageId, a.archiveIds);
}

const drawingOf = (row: typeof notesDrawings.$inferSelect): Drawing => ({ id: row.id, scene: row.scene, version: row.version, updatedAt: iso(row.updatedAt) });

export function createNotesRepo(db: Db): NotesRepo {
  const tagsOf = async (ids: string[]) => {
    const rows = ids.length ? await db.select().from(notesTags).where(inArray(notesTags.pageId, ids)).orderBy(notesTags.tag) : [];
    return (id: string) => rows.filter((r) => r.pageId === id).map((r) => r.tag);
  };

  async function getPage(id: string): Promise<Page | null> {
    const [row] = await db.select().from(notesPages).where(eq(notesPages.id, id));
    if (!row) return null;
    const linked = await db
      .selectDistinct({ id: notesPages.id, title: notesPages.title })
      .from(notesLinks)
      .innerJoin(notesPages, eq(notesPages.id, notesLinks.toPageId))
      .where(eq(notesLinks.fromPageId, id));
    return {
      id: row.id,
      title: row.title,
      tags: (await tagsOf([id]))(id),
      doc: row.doc,
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      linkTitles: Object.fromEntries(linked.map((l) => [l.id, l.title])),
    };
  }

  const mustGet = async (id: string) => {
    const page = await getPage(id);
    if (!page) throw new NotesError("not_found", "page not found");
    return page;
  };

  // The version a page is at, to tell "gone" from "saved by someone else" after an update missed.
  async function missed(table: typeof notesPages | typeof notesDrawings, id: string, what: string): Promise<never> {
    const [row] = await db.select({ version: table.version }).from(table).where(eq(table.id, id));
    if (!row) throw new NotesError("not_found", `${what} not found`);
    throw new NotesError("version_conflict", `the ${what} was saved elsewhere since this version`, row.version);
  }

  return {
    async createPage({ title, tags, doc }) {
      const analysis = analyzeDoc(doc);
      const id = await db.transaction(async (tx) => {
        const row = single(
          await tx
            .insert(notesPages)
            .values({ title: title || UNTITLED, doc, text: analysis.text })
            .returning({ id: notesPages.id }),
        );
        const unique = uniqueSorted(tags);
        if (unique.length) await tx.insert(notesTags).values(unique.map((tag) => ({ pageId: row.id, tag })));
        await indexDoc(tx, row.id, analysis);
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
        if (tsquery) conds.push(sql`${notesPages.search} @@ to_tsquery('simple', ${tsquery})`);
        else if (tags.length === 0) return { items: [], nextCursor: null };
      }
      for (const t of tags) {
        conds.push(exists(db.select({ x: sql`1` }).from(notesTags).where(and(eq(notesTags.pageId, notesPages.id), eq(notesTags.tag, t)))));
      }
      if (cursor) {
        const m = CURSOR.exec(cursor);
        if (!m) return { items: [], nextCursor: null };
        conds.push(sql`(${notesPages.updatedAt}, ${notesPages.id}) < (timestamptz 'epoch' + ${m[1]}::bigint * interval '1 microsecond', ${m[2]}::uuid)`);
      }
      const rows = await db
        .select({
          id: notesPages.id,
          title: notesPages.title,
          snippet: sql<string>`left(${notesPages.text}, ${SNIPPET})`,
          updatedAt: notesPages.updatedAt,
          at: updatedMicros,
        })
        .from(notesPages)
        .where(and(...conds))
        .orderBy(desc(notesPages.updatedAt), desc(notesPages.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const tagged = await tagsOf(page.map((r) => r.id));
      const items = page.map((r): PageSummary => ({ id: r.id, title: r.title, tags: tagged(r.id), snippet: r.snippet, updatedAt: iso(r.updatedAt) }));
      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last ? `${last.at}_${last.id}` : null };
    },

    async savePage(id, { title, doc, baseVersion }) {
      const analysis = analyzeDoc(doc);
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(notesPages)
          .set({ title: title || UNTITLED, doc, text: analysis.text, version: sql`${notesPages.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(notesPages.id, id), eq(notesPages.version, baseVersion)))
          .returning({ version: notesPages.version, updatedAt: notesPages.updatedAt });
        if (!row) return null;
        await indexDoc(tx, id, analysis);
        return { version: row.version, updatedAt: iso(row.updatedAt) };
      });
      return saved ?? missed(notesPages, id, "page");
    },

    async setTags(id, tags) {
      const found = await db.transaction(async (tx) => {
        const [row] = await tx.select({ id: notesPages.id }).from(notesPages).where(eq(notesPages.id, id)).for("update");
        if (!row) return false;
        await tx.delete(notesTags).where(eq(notesTags.pageId, id));
        const unique = uniqueSorted(tags);
        if (unique.length) await tx.insert(notesTags).values(unique.map((tag) => ({ pageId: id, tag })));
        return true;
      });
      return found ? getPage(id) : null;
    },

    async deletePage(id) {
      return db.transaction(async (tx) => {
        const drawings = (await tx.select({ id: notesPageDrawings.drawingId }).from(notesPageDrawings).where(eq(notesPageDrawings.pageId, id))).map((r) => r.id);
        const rows = await tx.delete(notesPages).where(eq(notesPages.id, id)).returning({ id: notesPages.id });
        if (rows.length === 0) return false;
        await setRefs(tx, MODULE, id, []);
        await detachUnused(tx, drawings);
        return true;
      });
    },

    async backlinks(id) {
      const rows = await db
        .select({
          pageId: notesLinks.fromPageId,
          pageTitle: notesPages.title,
          blockId: notesLinks.fromBlockId,
          text: notesBlocks.text,
          targetBlockId: notesLinks.toBlockId,
        })
        .from(notesLinks)
        .innerJoin(notesPages, eq(notesPages.id, notesLinks.fromPageId))
        .leftJoin(notesBlocks, and(eq(notesBlocks.pageId, notesLinks.fromPageId), eq(notesBlocks.blockId, notesLinks.fromBlockId)))
        .where(and(eq(notesLinks.toPageId, id), ne(notesLinks.fromPageId, id)))
        .orderBy(desc(notesPages.updatedAt), notesBlocks.position)
        .limit(200);
      return rows.map((r): Backlink => ({ ...r, text: r.text ?? "" }));
    },

    async searchBlocks(q, limit) {
      const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
      const rows = await db
        .select({ pageId: notesBlocks.pageId, pageTitle: notesPages.title, blockId: notesBlocks.blockId, type: notesBlocks.type, text: notesBlocks.text })
        .from(notesBlocks)
        .innerJoin(notesPages, eq(notesPages.id, notesBlocks.pageId))
        .where(and(ne(notesBlocks.text, ""), ...words.map((w) => or(ilike(notesBlocks.text, likeWord(w)), ilike(notesPages.title, likeWord(w))))))
        .orderBy(desc(notesPages.updatedAt), notesBlocks.position)
        .limit(limit);
      return rows;
    },

    async tagCounts() {
      const count = sql<number>`count(*)::int`;
      return db.select({ tag: notesTags.tag, count }).from(notesTags).groupBy(notesTags.tag).orderBy(notesTags.tag);
    },

    async createDrawing() {
      return drawingOf(single(await db.insert(notesDrawings).values({ scene: { elements: [] } }).returning()));
    },

    async getDrawing(id) {
      const [row] = await db.select().from(notesDrawings).where(eq(notesDrawings.id, id));
      return row ? drawingOf(row) : null;
    },

    async saveDrawing(id, { scene, baseVersion }) {
      const [row] = await db
        .update(notesDrawings)
        .set({ scene, version: sql`${notesDrawings.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(notesDrawings.id, id), eq(notesDrawings.version, baseVersion)))
        .returning({ version: notesDrawings.version, updatedAt: notesDrawings.updatedAt });
      return row ? { version: row.version, updatedAt: iso(row.updatedAt) } : missed(notesDrawings, id, "drawing");
    },

    async deleteDetachedDrawings(before) {
      const rows = await db
        .delete(notesDrawings)
        .where(
          and(
            isNotNull(notesDrawings.detachedAt),
            lt(notesDrawings.detachedAt, before),
            notExists(db.select({ x: sql`1` }).from(notesPageDrawings).where(eq(notesPageDrawings.drawingId, notesDrawings.id))),
          ),
        )
        .returning({ id: notesDrawings.id });
      return rows.length;
    },
  };
}
