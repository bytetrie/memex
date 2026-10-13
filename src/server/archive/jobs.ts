// The job worker: runs queued jobs one at a time, oldest first, and creates each job's entry when
// it finishes. It lives in the app process (started by server.ts), keeps the job row up to date
// (stage, progress, the last lines the tools printed) and cleans up after every job: the runners'
// job folders always, and the blobs it imported when the job didn't produce an entry.
// Node-free: runners, the incoming folder and the stores come in as ports.

import type { z } from "zod";
import type { Job, JobStage } from "../../shared/archive-jobs.ts";
import { MAX_FILE_BYTES } from "../../shared/archive-types.ts";
import { ErrorEventSchema, HeartbeatEventSchema, LogEventSchema, ProgressEventSchema } from "../../shared/runners.ts";
import type { Logger } from "../types.ts";
import { limitBytes } from "./http.ts";
import { ArchiveError, type ArchiveRepo, type BlobStore, type IncomingStore, type JobControl, type JobRepo, type RunnerClient } from "./ports.ts";
import type { JobContext } from "./types/define.ts";
import { archiveTypes } from "./types/index.ts";

const LOG_LINES = 100;
const LOG_LINE_CHARS = 500;
const WRITE_EVERY_MS = 1000;

export type WorkerDeps = {
  repo: ArchiveRepo;
  blobs: BlobStore;
  jobs: JobRepo;
  incoming: IncomingStore;
  runners: RunnerClient;
  log: Logger;
};

export type JobWorker = JobControl & {
  // Marks jobs cut off by a restart as failed, clears the incoming folder and starts on the queue.
  start(): Promise<void>;
  // Stops taking jobs and cancels the running one.
  stop(): void;
  // Resolves when the worker has nothing left to do (tests).
  idle(): Promise<void>;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export function createJobWorker(deps: WorkerDeps): JobWorker {
  const { repo, blobs, jobs, incoming, runners } = deps;
  let current: { id: string; abort: AbortController } | null = null;
  let loop: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  function wake() {
    if (stopped) return;
    if (loop) {
      again = true;
      return;
    }
    again = false;
    loop = drain()
      .catch((err: unknown) => {
        deps.log.error({ err }, "job worker failed");
      })
      .finally(() => {
        loop = null;
        if (again) wake();
      });
  }

  async function drain() {
    while (!stopped) {
      const job = await jobs.claimNext();
      if (!job) return;
      await runOne(job);
    }
  }

  async function runOne(job: Job) {
    const abort = new AbortController();
    current = { id: job.id, abort };
    const log = deps.log.child({ job: job.id, type: job.type });
    log.info({ event: "job.started" }, "job started");

    const tail: string[] = [];
    const dirs = new Set<string>();
    const imported = new Set<string>();
    let state: { stage: JobStage; progress: number | null; detail: string | null } = { stage: "download", progress: null, detail: null };
    // Written from callbacks, so kept in an object (TypeScript doesn't track callback assignments).
    const writes: { last: number; timer: ReturnType<typeof setTimeout> | null } = { last: 0, timer: null };

    const write = () => {
      writes.timer = null;
      writes.last = Date.now();
      jobs.updateRunning(job.id, { ...state, logTail: tail.join("\n") }).catch((err: unknown) => {
        log.error({ err }, "could not update the job");
      });
    };
    // At most one row update per second, the latest state always ends up written.
    const changed = () => {
      if (writes.timer) return;
      const wait = WRITE_EVERY_MS - (Date.now() - writes.last);
      if (wait <= 0) write();
      else writes.timer = setTimeout(write, wait);
    };
    const addLog = (line: string) => {
      tail.push(line.slice(0, LOG_LINE_CHARS));
      if (tail.length > LOG_LINES) tail.shift();
      changed();
    };
    const keepBlob = async (blob: { sha256: string; size: number }) => {
      await repo.registerBlob(blob);
      imported.add(blob.sha256);
      return blob;
    };

    const ctx: JobContext = {
      async runner(name, request, doneSchema) {
        // Filled in by the event callback below.
        const reply: { done?: z.output<typeof doneSchema>; failure?: string; unreadable: boolean } = { unreadable: false };
        await runners.run(name, request, {
          signal: abort.signal,
          onEvent(raw) {
            const progress = ProgressEventSchema.safeParse(raw);
            if (progress.success) {
              ctx.progress(progress.data.stage, progress.data.percent, progress.data.detail ?? null);
              return;
            }
            const line = LogEventSchema.safeParse(raw);
            if (line.success) {
              addLog(line.data.line);
              return;
            }
            if (HeartbeatEventSchema.safeParse(raw).success) return;
            const error = ErrorEventSchema.safeParse(raw);
            if (error.success) {
              reply.failure = error.data.message;
              return;
            }
            const result = doneSchema.safeParse(raw);
            if (result.success) reply.done = result.data;
            else reply.unreadable = true;
          },
        });
        if (abort.signal.aborted) throw new Error("cancelled");
        // A runner job folder (`dir`) is removed when the job ends, whatever happens.
        const { done } = reply;
        if (typeof done === "object" && done !== null && "dir" in done && typeof done.dir === "string") dirs.add(done.dir);
        if (reply.failure !== undefined) throw new Error(reply.failure);
        if (reply.unreadable) throw new Error(`runner ${name} sent a reply the app doesn't understand`);
        if (done === undefined) throw new Error(`runner ${name} ended without a result`);
        return done;
      },
      async importFile(dir, name) {
        const { stream, size } = await incoming.open(dir, name);
        if (size > MAX_FILE_BYTES) throw new ArchiveError("too_large", `${name} is larger than ${String(MAX_FILE_BYTES)} bytes`);
        return keepBlob(await blobs.put(limitBytes(stream, MAX_FILE_BYTES)));
      },
      readHead: (dir, name, maxBytes) => incoming.head(dir, name, maxBytes),
      putBlob: async (stream) => keepBlob(await blobs.put(stream)),
      progress(stage, percent, detail) {
        state = { stage, progress: percent, detail };
        changed();
      },
      findEntryBySource: (url) => repo.findBySource(job.type, url),
      log,
      signal: abort.signal,
    };

    let outcome: Parameters<JobRepo["finish"]>[1];
    try {
      const handler = archiveTypes[job.type];
      if (handler.mode !== "job") throw new Error(`${job.type} is not a job type`);
      const result = await handler.run(job.input, ctx);
      if (abort.signal.aborted) throw new Error("cancelled");
      ctx.progress("import", null, "Creating the entry");
      const entry = await repo.createEntry({
        type: job.type,
        title: job.title ?? result.title,
        sourceUrl: result.sourceUrl,
        meta: result.meta,
        searchText: result.searchText,
        tags: job.tags,
        files: result.files,
      });
      imported.clear(); // the entry owns them now
      outcome = { status: "done", entryId: entry.id, logTail: tail.join("\n") };
      log.info({ event: "entry.created", id: entry.id, type: entry.type }, "entry created by a job");
    } catch (err) {
      const cancelled = abort.signal.aborted;
      outcome = { status: cancelled ? "cancelled" : "failed", error: cancelled ? "cancelled" : errorText(err), logTail: tail.join("\n") };
      if (!cancelled) log.warn({ event: "job.failed", err }, "job failed");
    } finally {
      if (writes.timer) clearTimeout(writes.timer);
      current = null;
    }

    for (const dir of dirs) {
      await incoming.removeDir(dir).catch((err: unknown) => {
        log.error({ err, dir }, "could not remove a runner job folder");
      });
    }
    // Blobs this job imported but no entry uses: remove them now rather than in a day.
    for (const sha256 of imported) {
      try {
        if (await repo.deleteBlobIfUnreferenced(sha256)) await blobs.delete(sha256);
      } catch (err) {
        log.error({ err, sha256 }, "could not remove an imported blob");
      }
    }
    await jobs.finish(job.id, outcome);
    log.info({ event: `job.${outcome.status}` }, `job ${outcome.status}`);
  }

  return {
    wake,
    cancelRunning(id) {
      if (current?.id !== id) return false;
      current.abort.abort();
      return true;
    },
    async start() {
      const interrupted = await jobs.failRunning("interrupted: the app restarted while this job ran; retry it");
      const removed = await incoming.sweep(Date.now()); // no job runs yet, so every job folder is left over
      if (interrupted || removed) deps.log.info({ event: "jobs.recovered", interrupted, removed }, "cleaned up after a restart");
      wake();
    },
    stop() {
      stopped = true;
      current?.abort.abort();
    },
    async idle() {
      while (loop) await loop;
    },
  };
}
