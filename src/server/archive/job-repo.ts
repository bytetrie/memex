// The job queue's queries (drizzle). Implements JobRepo from ports.ts; like repo.ts, only server.ts
// and tests import it. Status and stage are plain text columns, parsed on the way out.

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { JobStageSchema, JobStatusSchema, type Job } from "../../shared/archive-jobs.ts";
import { ArchiveTypeIdSchema } from "../../shared/archive-types.ts";
import type { Db } from "../db/client.ts";
import { archiveJobs } from "../db/schema.ts";
import { ArchiveError, type JobRepo } from "./ports.ts";

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? iso(d) : null);
const FINISHED = ["done", "failed", "cancelled"];

export function createJobRepo(db: Db): JobRepo {
  // Jobs ahead of a queued one: the running job plus those queued before it. Written out in SQL
  // with explicit table names: drizzle leaves the outer columns unqualified, which would bind them to
  // the inner table.
  const ahead = sql<number | null>`case when "archive_jobs"."status" = 'queued' then (
    select count(*)::int from "archive_jobs" as "other"
    where "other"."status" = 'running'
       or ("other"."status" = 'queued' and ("other"."queued_at", "other"."id") < ("archive_jobs"."queued_at", "archive_jobs"."id"))
  ) end`;

  const select = () => db.select({ row: archiveJobs, ahead }).from(archiveJobs);

  const toJob = ({ row, ahead: n }: { row: typeof archiveJobs.$inferSelect; ahead: number | null }): Job => ({
    id: row.id,
    type: ArchiveTypeIdSchema.parse(row.type),
    input: row.input,
    title: row.title,
    tags: row.tags,
    status: JobStatusSchema.parse(row.status),
    ahead: n,
    stage: row.stage === null ? null : JobStageSchema.parse(row.stage),
    progress: row.progress,
    detail: row.detail,
    error: row.error,
    logTail: row.logTail,
    entryId: row.entryId,
    createdAt: iso(row.createdAt),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  });

  async function getJob(id: string): Promise<Job | null> {
    const [row] = await select().where(eq(archiveJobs.id, id));
    return row ? toJob(row) : null;
  }

  return {
    async createJob(job) {
      const [row] = await db
        .insert(archiveJobs)
        .values({ type: job.type, input: job.input, sourceUrl: job.sourceUrl, title: job.title ?? null, tags: [...new Set(job.tags ?? [])].sort() })
        .returning({ id: archiveJobs.id });
      const created = row ? await getJob(row.id) : null;
      if (!created) throw new Error("the new job could not be read back");
      return created;
    },

    getJob,

    async listJobs(statuses, limit) {
      if (statuses.length === 0) return [];
      const rows = await select().where(inArray(archiveJobs.status, statuses)).orderBy(desc(archiveJobs.queuedAt), desc(archiveJobs.id)).limit(limit);
      return rows.map(toJob);
    },

    async countQueued() {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(archiveJobs).where(eq(archiveJobs.status, "queued"));
      return row?.n ?? 0;
    },

    async findActiveBySource(type, url) {
      const [row] = await db
        .select({ id: archiveJobs.id })
        .from(archiveJobs)
        .where(and(eq(archiveJobs.type, type), eq(archiveJobs.sourceUrl, url), inArray(archiveJobs.status, ["queued", "running"])))
        .limit(1);
      return row?.id ?? null;
    },

    async claimNext() {
      // One statement, so a job can't be claimed twice (there is one worker, but restarts overlap).
      const rows = await db.execute<{ id: string }>(sql`
        update ${archiveJobs} set status = 'running', started_at = now(), stage = null, progress = null, detail = null
        where ${archiveJobs.id} = (
          select id from ${archiveJobs} where status = 'queued' order by queued_at, id limit 1 for update skip locked
        )
        returning ${archiveJobs.id}`);
      const [row] = rows;
      return row ? getJob(row.id) : null;
    },

    async updateRunning(id, p) {
      await db
        .update(archiveJobs)
        .set({ stage: p.stage, progress: p.progress, detail: p.detail, logTail: p.logTail })
        .where(and(eq(archiveJobs.id, id), eq(archiveJobs.status, "running")));
    },

    async finish(id, outcome) {
      await db
        .update(archiveJobs)
        .set({
          status: outcome.status,
          error: outcome.error ?? null,
          entryId: outcome.entryId ?? null,
          logTail: outcome.logTail,
          finishedAt: sql`now()`,
          ...(outcome.status === "done" ? { progress: 100, detail: null } : {}),
        })
        .where(eq(archiveJobs.id, id));
    },

    async cancelQueued(id) {
      await db
        .update(archiveJobs)
        .set({ status: "cancelled", finishedAt: sql`now()` })
        .where(and(eq(archiveJobs.id, id), eq(archiveJobs.status, "queued")));
      return getJob(id);
    },

    async requeue(id) {
      await db
        .update(archiveJobs)
        .set({ status: "queued", queuedAt: sql`now()`, startedAt: null, finishedAt: null, stage: null, progress: null, detail: null, error: null, logTail: "" })
        .where(and(eq(archiveJobs.id, id), inArray(archiveJobs.status, ["failed", "cancelled"])));
      return getJob(id);
    },

    async deleteJob(id) {
      const job = await getJob(id);
      if (!job) return false;
      if (!FINISHED.includes(job.status)) throw new ArchiveError("conflict", `the job is ${job.status}; cancel it first`);
      await db.delete(archiveJobs).where(and(eq(archiveJobs.id, id), inArray(archiveJobs.status, FINISHED)));
      return true;
    },

    async failRunning(error) {
      const rows = await db
        .update(archiveJobs)
        .set({ status: "failed", error, finishedAt: sql`now()` })
        .where(eq(archiveJobs.status, "running"))
        .returning({ id: archiveJobs.id });
      return rows.length;
    },

    async deleteFinished(before) {
      const rows = await db
        .delete(archiveJobs)
        .where(and(inArray(archiveJobs.status, FINISHED), lt(archiveJobs.finishedAt, before)))
        .returning({ id: archiveJobs.id });
      return rows.length;
    },
  };
}
