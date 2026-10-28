// What notes need from their environment, as a node-free interface (implementation: repo.ts).
// Tests and scripts/check-csp.ts pass their own.

import type { Doc } from "../../shared/notes-doc.ts";
import type { Backlink, BlockHit, Drawing, Page, PageList, PageListQuery, Saved, Scene, TagCount } from "../../shared/notes.ts";

export type NotesErrorCode = "not_found" | "version_conflict";

// Thrown by the repo; routes map `code` to an HTTP status. version_conflict: detail is the current version.
export class NotesError extends Error {
  code: NotesErrorCode;
  detail?: unknown;
  constructor(code: NotesErrorCode, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface NotesRepo {
  createPage(page: { title: string; tags: string[]; doc: Doc }): Promise<Page>;
  getPage(id: string): Promise<Page | null>;
  listPages(query: PageListQuery): Promise<PageList>;
  // Throws NotesError: not_found, version_conflict (someone saved since baseVersion).
  // Rebuilds the page's blocks, links, drawing uses and archive refs from `doc`.
  savePage(id: string, save: { title: string; doc: Doc; baseVersion: number }): Promise<Saved>;
  // null if the page doesn't exist.
  setTags(id: string, tags: string[]): Promise<Page | null>;
  // false if the page doesn't exist. Releases its archive refs; its drawings are detached.
  deletePage(id: string): Promise<boolean>;
  backlinks(id: string): Promise<Backlink[]>;
  searchBlocks(q: string, limit: number): Promise<BlockHit[]>;
  tagCounts(): Promise<TagCount[]>;

  createDrawing(): Promise<Drawing>;
  getDrawing(id: string): Promise<Drawing | null>;
  // Throws NotesError: not_found, version_conflict.
  saveDrawing(id: string, save: { scene: Scene; baseVersion: number }): Promise<Saved>;
  // Deletes drawings that no page has shown since `before`; returns how many.
  deleteDetachedDrawings(before: Date): Promise<number>;
}

export type NotesDeps = { repo: NotesRepo };
