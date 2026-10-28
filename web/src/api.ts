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
import {
  BacklinksSchema,
  BlockHitsSchema,
  DrawingSchema,
  PageListSchema,
  PageSchema,
  SavedSchema,
  TagCountsSchema,
  VersionConflictSchema,
  type CreatePage,
  type PageListQuery,
  type SaveDrawing,
  type SavePage,
} from "../../src/shared/notes.ts";

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

// --- notes ------------------------------------------------------------------------

// A save answered 409: the page or drawing was saved elsewhere; `version` is the current one.
export class VersionConflictError extends Error {
  version: number;
  constructor(message: string, version: number) {
    super(message);
    this.version = version;
  }
}

async function saved(res: Response) {
  const status: number = res.status; // 409 comes from the error handler, which the typed client doesn't see
  if (status === 409) {
    const body = VersionConflictSchema.parse(await res.json());
    throw new VersionConflictError(body.error, body.version);
  }
  return SavedSchema.parse(await ok(res));
}

export const listPages = async (params: Partial<Pick<PageListQuery, "q" | "tag" | "cursor" | "limit">>) => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries<string | number | undefined>(params)) if (value !== undefined && value !== "") query[key] = String(value);
  return PageListSchema.parse(await ok(await api.notes.pages.$get({ query })));
};

// null when the page does not exist.
export const getPage = async (id: string) => {
  const res = await api.notes.pages[":id"].$get({ param: { id } });
  return res.status === 404 ? null : PageSchema.parse(await ok(res));
};

export const createPage = async (input: CreatePage) => PageSchema.parse(await ok(await api.notes.pages.$post({ json: input })));

// `keepalive` lets the request finish while the tab closes (bodies up to 64 KiB).
export const savePage = async (id: string, input: SavePage, opts: { keepalive?: boolean } = {}) =>
  saved(await api.notes.pages[":id"].$put({ param: { id }, json: input }, { init: { keepalive: opts.keepalive ?? false } }));

export const setPageTags = async (id: string, tags: string[]) =>
  PageSchema.parse(await ok(await api.notes.pages[":id"].$patch({ param: { id }, json: { tags } })));

export const deletePage = async (id: string) => okEmpty(await api.notes.pages[":id"].$delete({ param: { id } }));

export const getBacklinks = async (id: string) =>
  BacklinksSchema.parse(await ok(await api.notes.pages[":id"].backlinks.$get({ param: { id } }))).items;

export const searchBlocks = async (q: string) => BlockHitsSchema.parse(await ok(await api.notes.blocks.$get({ query: { q } }))).items;

export const getNoteTags = async () => TagCountsSchema.parse(await ok(await api.notes.tags.$get())).items;

export const createDrawing = async () => DrawingSchema.parse(await ok(await api.notes.drawings.$post()));

// null when the drawing does not exist.
export const getDrawing = async (id: string) => {
  const res = await api.notes.drawings[":id"].$get({ param: { id } });
  return res.status === 404 ? null : DrawingSchema.parse(await ok(res));
};

export const saveDrawing = async (id: string, input: SaveDrawing) => saved(await api.notes.drawings[":id"].$put({ param: { id }, json: input }));
