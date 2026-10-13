// /api/archive/jobs/*: background additions (types with mode "job", e.g. video). Mounted by routes.ts.
// A job is queued here and run by the worker (jobs.ts), one at a time; clients poll it.

import { Hono } from "hono";
import { z } from "zod";
import { CreateJobSchema, DuplicateSchema, JobListQuerySchema, JobListSchema, JobSchema, MAX_QUEUED_JOBS } from "../../shared/archive-jobs.ts";
import { docs, failure, json } from "../openapi.ts";
import type { AppEnv } from "../types.ts";
import { validate } from "../validate.ts";
import { ArchiveError, type ArchiveDeps } from "./ports.ts";
import { archiveTypes } from "./types/index.ts";

const TAG = "archive jobs";
const idParam = z.object({ id: z.uuid() });

export function createJobRoutes({ repo, jobs, worker }: ArchiveDeps) {
  const mustGet = async (id: string) => {
    const job = await jobs.getJob(id);
    if (!job) throw new ArchiveError("not_found", "job not found");
    return job;
  };

  return new Hono<AppEnv>()
    .post(
      "/",
      docs(
        TAG,
        "Queue a job that adds an entry",
        {
          202: json("The queued job; poll GET /archive/jobs/:id", JobSchema),
          400: failure("Invalid body, invalid `input` for the type, or a type that is added with POST /archive/entries"),
          409: json("Already archived (entryId) or already queued (jobId)", DuplicateSchema),
          429: failure(`More than ${String(MAX_QUEUED_JOBS)} jobs are waiting`),
        },
        "For types whose `mode` is \"job\" in GET /archive/types (e.g. video: `{\"type\":\"video\",\"input\":{\"url\":\"https://...\"}}`). Jobs run one at a time, in order.",
      ),
      validate("json", CreateJobSchema),
      async (c) => {
        const body = c.req.valid("json");
        const handler = archiveTypes[body.type];
        if (handler.mode !== "job") throw new ArchiveError("wrong_mode", `${body.type} entries are added directly: use POST /archive/entries`);
        const { input, sourceUrl } = handler.prepare(body.input);
        if (sourceUrl !== null) {
          const entryId = await repo.findBySource(body.type, sourceUrl);
          if (entryId) throw new ArchiveError("conflict", "this is already archived", { entryId });
          const jobId = await jobs.findActiveBySource(body.type, sourceUrl);
          if (jobId) throw new ArchiveError("conflict", "this is already queued", { jobId });
        }
        if ((await jobs.countQueued()) >= MAX_QUEUED_JOBS) throw new ArchiveError("queue_full", `${String(MAX_QUEUED_JOBS)} jobs are already waiting; try again later`);
        const job = await jobs.createJob({ type: body.type, input, sourceUrl, title: body.title, tags: body.tags });
        c.var.log.info({ event: "job.queued", id: job.id, type: job.type }, "job queued");
        worker.wake();
        return c.json(job, 202);
      },
    )

    .get(
      "/",
      docs(TAG, "List jobs", { 200: json("Newest first; by default what is queued, running or failed", JobListSchema) }),
      validate("query", JobListQuerySchema),
      async (c) => {
        const { status, limit } = c.req.valid("query");
        return c.json({ items: await jobs.listJobs(status, limit) });
      },
    )

    .get(
      "/:id",
      docs(TAG, "Get a job", { 200: json("The job: status, stage, progress, error", JobSchema), 404: failure("No such job") }),
      validate("param", idParam),
      async (c) => c.json(await mustGet(c.req.valid("param").id)),
    )

    .post(
      "/:id/cancel",
      docs(
        TAG,
        "Cancel a job",
        { 200: json("The job; a running one reports \"cancelled\" once its runner has stopped", JobSchema), 404: failure("No such job"), 409: failure("Already finished") },
      ),
      validate("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        const job = await mustGet(id);
        if (job.status === "queued") return c.json((await jobs.cancelQueued(id)) ?? job);
        if (job.status === "running" && worker.cancelRunning(id)) {
          c.var.log.info({ event: "job.cancel", id }, "cancelling the running job");
          return c.json(job);
        }
        throw new ArchiveError("conflict", `the job is ${job.status}`);
      },
    )

    .post(
      "/:id/retry",
      docs(TAG, "Queue a failed or cancelled job again", { 200: json("The job, queued at the back", JobSchema), 404: failure("No such job"), 409: failure("Not failed or cancelled") }),
      validate("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        const job = await mustGet(id);
        if (job.status !== "failed" && job.status !== "cancelled") throw new ArchiveError("conflict", `the job is ${job.status}`);
        const handler = archiveTypes[job.type];
        const sourceUrl = handler.mode === "job" ? handler.prepare(job.input).sourceUrl : null;
        if (sourceUrl !== null) {
          const entryId = await repo.findBySource(job.type, sourceUrl);
          if (entryId) throw new ArchiveError("conflict", "this is already archived", { entryId });
        }
        const queued = (await jobs.requeue(id)) ?? job;
        worker.wake();
        return c.json(queued);
      },
    )

    .delete(
      "/:id",
      docs(TAG, "Dismiss a finished job", { 204: { description: "Removed" }, 404: failure("No such job"), 409: failure("Still queued or running; cancel it first") }),
      validate("param", idParam),
      async (c) => ((await jobs.deleteJob(c.req.valid("param").id)) ? c.body(null, 204) : c.json({ error: "job not found" }, 404)),
    );
}
