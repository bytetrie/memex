// What the archive needs from its environment, as node-free interfaces.
// Implementations: db/ + archive/repo.ts (drizzle), node/blob-store.ts (disk).
// Tests and scripts/check-csp.ts pass their own.

import type { ArchiveRef, Entry, EntryList, FileRole, ListQuery, RecentSearches } from "../../shared/archive.ts";
import type { Job, JobStage, JobStatus } from "../../shared/archive-jobs.ts";
import type { ArchiveTypeId } from "../../shared/archive-types.ts";
import type { RunnerName } from "../../shared/runners.ts";

export type ByteStream = ReadableStream<Uint8Array>;

export interface BlobStore {
  // Copies and hashes the bytes; writing an existing hash is a no-op.
  put(stream: ByteStream): Promise<{ sha256: string; size: number }>;
  // null if the blob is not on disk. `range` is inclusive, like HTTP.
  get(sha256: string, range?: { start: number; end: number }): Promise<ByteStream | null>;
  delete(sha256: string): Promise<void>;
  list(): AsyncIterable<{ sha256: string; mtimeMs: number }>;
  // Removes upload temp files last modified before `olderThanMs`; returns how many.
  sweepTmp(olderThanMs: number): Promise<number>;
}

export type NewFile = { sha256: string; name: string; mime: string; role: FileRole };

export type NewEntry = {
  type: ArchiveTypeId;
  title: string;
  sourceUrl?: string | null;
  meta?: Record<string, unknown>;
  searchText?: string;
  tags?: string[];
  files: NewFile[];
};

export type ArchiveErrorCode = "not_found" | "conflict" | "unknown_blob" | "referenced" | "invalid" | "too_large" | "queue_full" | "wrong_mode";

// Thrown by the repo and type handlers; routes map `code` to an HTTP status.
export class ArchiveError extends Error {
  code: ArchiveErrorCode;
  detail?: unknown;
  constructor(code: ArchiveErrorCode, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface ArchiveRepo {
  registerBlob(blob: { sha256: string; size: number }): Promise<void>;
  // The subset of `shas` that has a blob row.
  existingBlobs(shas: string[]): Promise<Set<string>>;

  // Throws ArchiveError: unknown_blob, conflict (duplicate file name).
  createEntry(entry: NewEntry): Promise<Entry>;
  getEntry(id: string): Promise<Entry | null>;
  listEntries(query: ListQuery): Promise<EntryList>;
  // null if the entry doesn't exist.
  updateEntry(id: string, patch: { title?: string; tags?: string[] }): Promise<Entry | null>;
  // Throws ArchiveError: not_found, referenced (detail: the refs). Returns the blobs that no entry
  // uses any more (and nobody re-uploaded since they were attached); the caller removes them from
  // the store. Blobs left out are swept later by the gc.
  deleteEntry(id: string): Promise<string[]>;
  getFile(id: string, name: string): Promise<{ sha256: string; size: number; mime: string; role: FileRole } | null>;
  // The newest entry of `type` whose source URL is `url`, if any.
  findBySource(type: ArchiveTypeId, url: string): Promise<string | null>;

  // Throws ArchiveError not_found if the entry doesn't exist. Idempotent.
  putRef(id: string, module: ArchiveRef["module"], itemId: string): Promise<ArchiveRef>;
  deleteRef(id: string, module: ArchiveRef["module"], itemId: string): Promise<boolean>;

  recordSearch(search: { query: string; type?: ArchiveTypeId }): Promise<void>;
  recentSearches(limit: number): Promise<RecentSearches>;
  // Removes every recorded run of that search (same query and type; no type = the "all types" search only).
  deleteSearch(search: { query: string; type?: ArchiveTypeId }): Promise<void>;

  // Garbage collection support (see gc.ts).
  orphanBlobs(uploadedBefore: Date): Promise<string[]>;
  // true if the row was deleted; false if a file references it (or it is gone).
  deleteBlobIfUnreferenced(sha256: string): Promise<boolean>;
}

export type NewJob = { type: ArchiveTypeId; input: Record<string, unknown>; sourceUrl: string | null; title?: string; tags?: string[] };
export type JobProgress = { stage: JobStage; progress: number | null; detail: string | null; logTail: string };

export interface JobRepo {
  createJob(job: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(statuses: JobStatus[], limit: number): Promise<Job[]>;
  countQueued(): Promise<number>;
  // A queued or running job of `type` for `url`, if any.
  findActiveBySource(type: ArchiveTypeId, url: string): Promise<string | null>;
  // Marks the oldest queued job running and returns it; null when the queue is empty.
  claimNext(): Promise<Job | null>;
  updateRunning(id: string, progress: JobProgress): Promise<void>;
  finish(id: string, outcome: { status: "done" | "failed" | "cancelled"; error?: string; entryId?: string; logTail: string }): Promise<void>;
  // Queued -> cancelled. Returns the job; null if it doesn't exist.
  cancelQueued(id: string): Promise<Job | null>;
  // Failed or cancelled -> queued again, at the back. null if it doesn't exist; unchanged if not retryable.
  requeue(id: string): Promise<Job | null>;
  // Deletes a finished job. false if it doesn't exist; throws ArchiveError conflict while it is active.
  deleteJob(id: string): Promise<boolean>;
  // At boot: running jobs were cut off by a restart. Returns how many.
  failRunning(error: string): Promise<number>;
  // Removes finished jobs that ended before `before`; returns how many.
  deleteFinished(before: Date): Promise<number>;
}

// Talks to a runner (src/shared/runners.ts): sends `request`, hands each reply line (parsed JSON,
// still untrusted) to `onEvent`, resolves when the runner closes the connection. Rejects when the
// runner can't be reached, stops responding or sends something unreadable. `signal` hangs up,
// which stops the runner's job.
export interface RunnerClient {
  run(name: RunnerName, request: object, opts: { signal: AbortSignal; onEvent: (event: unknown) => void }): Promise<void>;
}

// The runners' output folder ($STATE_DIRECTORY/incoming). Every name is checked: `dir` is a job
// folder name, `name` a relative path inside it, and the file must be a regular file (no links).
export interface IncomingStore {
  open(dir: string, name: string): Promise<{ stream: ByteStream; size: number }>;
  // The first `maxBytes` bytes.
  head(dir: string, name: string, maxBytes: number): Promise<Uint8Array>;
  removeDir(dir: string): Promise<void>;
  // Removes job folders last modified before `olderThanMs`; returns how many.
  sweep(olderThanMs: number): Promise<number>;
}

// The job worker as routes see it.
export interface JobControl {
  // There may be a new queued job.
  wake(): void;
  // Stops the job if it is the running one; returns whether it was.
  cancelRunning(id: string): boolean;
}

export type ArchiveDeps = { repo: ArchiveRepo; blobs: BlobStore; jobs: JobRepo; worker: JobControl; incoming: IncomingStore };
