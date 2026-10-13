// Jobs: asynchronous additions to the archive (types whose content comes from runners, e.g. video).
// POST /archive/jobs queues one; a worker in the app runs them one at a time, oldest first, and
// creates the entry when a job finishes. Clients poll GET /archive/jobs/:id.

import { z } from "zod";
import { TagsSchema } from "./archive.ts";
import { ArchiveTypeIdSchema } from "./archive-types.ts";

export const JobStatusSchema = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const JobStageSchema = z.enum(["download", "encode", "import"]);
export type JobStage = z.infer<typeof JobStageSchema>;

// Most jobs that may wait in the queue at once.
export const MAX_QUEUED_JOBS = 50;

export const JobSchema = z.object({
  id: z.uuid(),
  type: ArchiveTypeIdSchema,
  input: z.record(z.string(), z.unknown()),
  title: z.string().nullable(), // the title asked for; null = the type picks one
  tags: z.array(z.string()),
  status: JobStatusSchema,
  // How many jobs run before this one (the running one included); null unless queued.
  ahead: z.number().int().nonnegative().nullable(),
  stage: JobStageSchema.nullable(),
  progress: z.number().min(0).max(100).nullable(), // within the stage; null = unknown
  detail: z.string().nullable(), // e.g. "12.3 MiB of 80.1 MiB, 4.2 MiB/s, ETA 16 s"
  error: z.string().nullable(), // why it failed, one line
  logTail: z.string(), // the last lines the tools printed, for failures
  entryId: z.uuid().nullable(), // the entry, once done (null again if the entry was deleted)
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobListSchema = z.object({ items: z.array(JobSchema) });
export type JobList = z.infer<typeof JobListSchema>;

// `input` is validated against the chosen type's schema (GET /archive/types lists them).
export const CreateJobSchema = z.object({
  type: ArchiveTypeIdSchema,
  title: z.string().trim().min(1).max(300).optional(),
  tags: TagsSchema.optional(),
  input: z.unknown(),
});
export type CreateJob = z.infer<typeof CreateJobSchema>;

export const ACTIVE_STATUSES = ["queued", "running"] as const satisfies JobStatus[];
// What GET /archive/jobs lists by default: what is waiting or running, and failures not yet dismissed.
export const DEFAULT_LISTED_STATUSES = ["queued", "running", "failed"] as const satisfies JobStatus[];

export const JobListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (s === undefined || s === "") return [...DEFAULT_LISTED_STATUSES];
      const parsed = z.array(JobStatusSchema).safeParse(s.split(","));
      if (parsed.success) return parsed.data;
      ctx.addIssue({ code: "custom", message: `expected a comma-separated list of ${JobStatusSchema.options.join(", ")}` });
      return z.NEVER;
    })
    .describe("Comma-separated statuses; default queued,running,failed"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type JobListQuery = z.infer<typeof JobListQuerySchema>;

// 409 bodies of POST /archive/jobs: the thing is already archived, or already queued.
export const DuplicateSchema = z.object({ error: z.string(), entryId: z.uuid().optional(), jobId: z.uuid().optional() });
