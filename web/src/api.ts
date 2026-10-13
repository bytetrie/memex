// Typed client for the Hono API in src/server/app.ts. Paths, params and
// response types come from AppType; responses are also parsed with the shared
// zod schemas so a server/client mismatch fails loudly here.

import { hc } from "hono/client";
import type { AppType } from "../../src/server/app.ts";
import { z } from "zod";
import { HealthSchema, ModuleSchema, type PlaceholderModuleId } from "../../src/shared/api.ts";
import {
  ArchiveTypeInfoSchema,
  BlobSchema,
  EntryListSchema,
  EntrySchema,
  RecentSearchesSchema,
  type CreateEntry,
  type ListQuery,
  type PatchEntry,
  type RecordSearch,
} from "../../src/shared/archive.ts";
import { DuplicateSchema, JobListSchema, JobSchema, type CreateJob, type JobStatus } from "../../src/shared/archive-jobs.ts";
import type { ArchiveTypeId } from "../../src/shared/archive-types.ts";

export const api = hc<AppType>("/").api;

// The server's own message when it sent one ({ error }), e.g. "clip.mp4 is not valid UTF-8 text; ...".
async function failure(res: Response): Promise<Error> {
  const body: unknown = await res.json().catch(() => null);
  const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : null;
  return new Error(message ?? `${new URL(res.url).pathname}: HTTP ${String(res.status)}`);
}

async function ok(res: Response): Promise<unknown> {
  if (!res.ok) throw await failure(res);
  return res.json();
}

export const getHealth = async () => HealthSchema.parse(await ok(await api.health.$get()));

export const getModule = async (id: PlaceholderModuleId) =>
  ModuleSchema.parse(await ok(await api.modules[":id"].$get({ param: { id } })));

// --- archive -----------------------------------------------------------------

async function okEmpty(res: Response): Promise<void> {
  if (!res.ok) throw await failure(res);
}

export const getArchiveTypes = async () => z.array(ArchiveTypeInfoSchema).parse(await ok(await api.archive.types.$get()));

type ListParams = Partial<Pick<ListQuery, "q" | "type" | "tag" | "cursor" | "limit">>;

export const listEntries = async (params: ListParams) => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries<string | number | undefined>(params)) if (value !== undefined && value !== "") query[key] = String(value);
  return EntryListSchema.parse(await ok(await api.archive.entries.$get({ query })));
};

// null when the entry does not exist.
export const getEntry = async (id: string) => {
  const res = await api.archive.entries[":id"].$get({ param: { id } });
  return res.status === 404 ? null : EntrySchema.parse(await ok(res));
};

export const createEntry = async (input: CreateEntry) =>
  EntrySchema.parse(await ok(await api.archive.entries.$post({ json: input })));

export const patchEntry = async (id: string, patch: PatchEntry) =>
  EntrySchema.parse(await ok(await api.archive.entries[":id"].$patch({ param: { id }, json: patch })));

export const deleteEntry = async (id: string) => okEmpty(await api.archive.entries[":id"].$delete({ param: { id } }));

export const getRecentSearches = async () => RecentSearchesSchema.parse(await ok(await api.archive.searches.$get()));

export const deleteSearch = async (search: { query: string; type?: ArchiveTypeId }) =>
  okEmpty(await api.archive.searches.$delete({ query: search.type ? { query: search.query, type: search.type } : { query: search.query } }));

export const recordSearch = async (search: RecordSearch) => okEmpty(await api.archive.searches.$post({ json: search }));

// Uploads one file's bytes (PUT with the raw body, which the typed client can't express).
export const uploadBlob = async (file: File) =>
  BlobSchema.parse(await ok(await fetch(api.archive.blobs.$path(), { method: "PUT", body: file })));

// URL of a file of an entry, for <img>, <video> and download links. The client
// does not encode path params, and a name may hold "/" (hls/index.m3u8).
export const fileUrl = (id: string, name: string) =>
  api.archive.entries[":id"].files[":name{.+}"].$path({ param: { id, name: name.split("/").map(encodeURIComponent).join("/") } });

// First `limit` bytes of a text file.
export const getFileText = async (id: string, name: string, limit: number) => {
  const res = await fetch(fileUrl(id, name), { headers: { range: `bytes=0-${String(limit - 1)}` } });
  if (!res.ok) throw new Error(`${fileUrl(id, name)}: HTTP ${String(res.status)}`);
  return res.text();
};

// --- archive jobs (types added in the background, e.g. video) -------------------

// POST /archive/jobs answered 409: the thing is already archived (entryId) or already queued (jobId).
export class DuplicateError extends Error {
  entryId: string | undefined;
  jobId: string | undefined;
  constructor(message: string, ids: { entryId?: string; jobId?: string }) {
    super(message);
    this.entryId = ids.entryId;
    this.jobId = ids.jobId;
  }
}

export const createJob = async (input: CreateJob) => {
  const res = await api.archive.jobs.$post({ json: input });
  const status: number = res.status; // 409 comes from the error handler, which the typed client doesn't see
  if (status === 409) {
    const body = DuplicateSchema.parse(await res.json());
    throw new DuplicateError(body.error, body);
  }
  return JobSchema.parse(await ok(res));
};

// Default statuses: queued, running and failed.
export const listJobs = async (statuses?: JobStatus[]) =>
  JobListSchema.parse(await ok(await api.archive.jobs.$get({ query: statuses ? { status: statuses.join(",") } : {} }))).items;

export const cancelJob = async (id: string) => JobSchema.parse(await ok(await api.archive.jobs[":id"].cancel.$post({ param: { id } })));
export const retryJob = async (id: string) => JobSchema.parse(await ok(await api.archive.jobs[":id"].retry.$post({ param: { id } })));
export const dismissJob = async (id: string) => okEmpty(await api.archive.jobs[":id"].$delete({ param: { id } }));
