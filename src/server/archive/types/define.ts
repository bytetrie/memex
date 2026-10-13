// The shape of an archive type handler and the helper that defines one.

import type { z } from "zod";
import type { JobStage } from "../../../shared/archive-jobs.ts";
import type { RunnerName } from "../../../shared/runners.ts";
import type { Logger } from "../../types.ts";
import { ArchiveError, type ByteStream, type NewFile } from "../ports.ts";
import type { TextInspection } from "../text.ts";

// What a handler may use. Handlers never touch node: modules, the DB or the
// disk directly, so a type can later run its work somewhere else (a runner).
export type IngestContext = {
  // Stores bytes in the archive's blob store and registers them.
  putBlob(stream: ByteStream): Promise<{ sha256: string; size: number }>;
  hasBlob(sha256: string): Promise<boolean>;
  // Removes an upload this handler refused, unless an entry uses those bytes. Call it for every
  // blob that is being rejected, so refused data doesn't linger until the gc.
  discardBlob(sha256: string): Promise<void>;
  // Checks that a stored blob is a text file and returns its first `headChars` characters.
  // null when the blob is not in the store.
  readText(sha256: string, headChars: number): Promise<TextInspection | null>;
  log: Logger;
};

export type IngestResult = {
  title: string;
  sourceUrl?: string;
  meta?: Record<string, unknown>;
  // Text to make findable by search (the first 200,000 characters count). Not returned by the API.
  searchText?: string;
  files: NewFile[];
};

// A type added within one request: POST /archive/entries.
export type EntryTypeHandler = {
  mode: "entry";
  label: string;
  input: z.ZodType; // also described to agents by GET /archive/types
  // Validates the raw input against `input`, then produces the entry's content.
  ingest(raw: unknown, ctx: IngestContext): Promise<IngestResult>;
};

// What a job type's `run` may use, on top of what the worker does for it (progress in the job row,
// the log tail, removing the runners' job folders when the job ends).
export type JobContext = {
  // Runs one runner job and returns its `done` event, parsed with `done`. Progress and log events
  // are passed on to the job; an `error` event, a dropped connection or a cancel throws.
  runner<S extends z.ZodType>(name: RunnerName, request: object, done: S): Promise<z.output<S>>;
  // Copies a file a runner left into the blob store (hashed, size-capped) and registers it.
  importFile(dir: string, name: string): Promise<{ sha256: string; size: number }>;
  // The first `maxBytes` bytes of a file a runner left.
  readHead(dir: string, name: string, maxBytes: number): Promise<Uint8Array>;
  putBlob(stream: ByteStream): Promise<{ sha256: string; size: number }>;
  // The job's current step, shown to whoever watches it.
  progress(stage: JobStage, percent: number | null, detail: string | null): void;
  // The newest entry of this type with that source URL, if any.
  findEntryBySource(url: string): Promise<string | null>;
  log: Logger;
  signal: AbortSignal;
};

// A type added in the background: POST /archive/jobs.
export type JobTypeHandler = {
  mode: "job";
  label: string;
  input: z.ZodType;
  // Validates the raw input (ArchiveError "invalid") and names its source, so the same thing isn't
  // queued or archived twice.
  prepare(raw: unknown): { input: Record<string, unknown>; sourceUrl: string | null };
  run(raw: unknown, ctx: JobContext): Promise<IngestResult>;
};

export type ArchiveTypeHandler = EntryTypeHandler | JobTypeHandler;

function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ArchiveError("invalid", "invalid input", issues);
  }
  return parsed.data;
}

export function defineType<S extends z.ZodType>(def: {
  label: string;
  input: S;
  ingest: (input: z.output<S>, ctx: IngestContext) => Promise<IngestResult>;
}): EntryTypeHandler {
  return {
    mode: "entry",
    label: def.label,
    input: def.input,
    ingest: (raw, ctx) => def.ingest(parseInput(def.input, raw), ctx),
  };
}

export function defineJobType<S extends z.ZodType<Record<string, unknown>>>(def: {
  label: string;
  input: S;
  sourceUrl: (input: z.output<S>) => string | null;
  run: (input: z.output<S>, ctx: JobContext) => Promise<IngestResult>;
}): JobTypeHandler {
  return {
    mode: "job",
    label: def.label,
    input: def.input,
    prepare(raw) {
      const input = parseInput(def.input, raw);
      return { input, sourceUrl: def.sourceUrl(input) };
    },
    run: (raw, ctx) => def.run(parseInput(def.input, raw), ctx),
  };
}
