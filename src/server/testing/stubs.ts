// Stand-ins for the archive's ports where a test or script needs an app but not the archive.
// Every method rejects unless overridden; tsc lists what is missing when a port grows.

import type { ArchiveRepo, BlobStore, IncomingStore, JobControl, JobRepo } from "../archive/ports.ts";
import type { NotesRepo } from "../notes/ports.ts";

const unused = (name: string) => () => Promise.reject(new Error(`stub: ${name} is not available`));

export function stubRepo(overrides: Partial<ArchiveRepo> = {}): ArchiveRepo {
  return {
    registerBlob: unused("repo.registerBlob"),
    existingBlobs: unused("repo.existingBlobs"),
    createEntry: unused("repo.createEntry"),
    getEntry: unused("repo.getEntry"),
    listEntries: unused("repo.listEntries"),
    updateEntry: unused("repo.updateEntry"),
    deleteEntry: unused("repo.deleteEntry"),
    getFile: unused("repo.getFile"),
    findBySource: unused("repo.findBySource"),
    putRef: unused("repo.putRef"),
    deleteRef: unused("repo.deleteRef"),
    recordSearch: unused("repo.recordSearch"),
    recentSearches: unused("repo.recentSearches"),
    deleteSearch: unused("repo.deleteSearch"),
    orphanBlobs: unused("repo.orphanBlobs"),
    deleteBlobIfUnreferenced: unused("repo.deleteBlobIfUnreferenced"),
    ...overrides,
  };
}

export function stubBlobs(overrides: Partial<BlobStore> = {}): BlobStore {
  return {
    put: unused("blobs.put"),
    get: unused("blobs.get"),
    delete: unused("blobs.delete"),
    list: () => ({ [Symbol.asyncIterator]: () => ({ next: unused("blobs.list") }) }),
    sweepTmp: unused("blobs.sweepTmp"),
    ...overrides,
  };
}

export function stubJobs(overrides: Partial<JobRepo> = {}): JobRepo {
  return {
    createJob: unused("jobs.createJob"),
    getJob: unused("jobs.getJob"),
    listJobs: unused("jobs.listJobs"),
    countQueued: unused("jobs.countQueued"),
    findActiveBySource: unused("jobs.findActiveBySource"),
    claimNext: unused("jobs.claimNext"),
    updateRunning: unused("jobs.updateRunning"),
    finish: unused("jobs.finish"),
    cancelQueued: unused("jobs.cancelQueued"),
    requeue: unused("jobs.requeue"),
    deleteJob: unused("jobs.deleteJob"),
    failRunning: unused("jobs.failRunning"),
    deleteFinished: unused("jobs.deleteFinished"),
    ...overrides,
  };
}

export function stubIncoming(overrides: Partial<IncomingStore> = {}): IncomingStore {
  return {
    open: unused("incoming.open"),
    head: unused("incoming.head"),
    removeDir: unused("incoming.removeDir"),
    sweep: unused("incoming.sweep"),
    ...overrides,
  };
}

export function stubNotesRepo(overrides: Partial<NotesRepo> = {}): NotesRepo {
  return {
    createPage: unused("notes.createPage"),
    getPage: unused("notes.getPage"),
    listPages: unused("notes.listPages"),
    savePage: unused("notes.savePage"),
    setTags: unused("notes.setTags"),
    deletePage: unused("notes.deletePage"),
    backlinks: unused("notes.backlinks"),
    searchBlocks: unused("notes.searchBlocks"),
    tagCounts: unused("notes.tagCounts"),
    createDrawing: unused("notes.createDrawing"),
    getDrawing: unused("notes.getDrawing"),
    saveDrawing: unused("notes.saveDrawing"),
    deleteDetachedDrawings: unused("notes.deleteDetachedDrawings"),
    ...overrides,
  };
}

export const idleWorker: JobControl = { wake: () => undefined, cancelRunning: () => false };
