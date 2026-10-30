// What the memex needs from its environment, as node-free interfaces (implementation: repo.ts,
// and node/blob-store.ts for the asset bytes). Tests and scripts/check-csp.ts pass their own.

import type { PageDoc } from "../../shared/memex-doc.ts";
import type { Asset, AssetMime, MemexPage, MemexPageList, MemexPageListQuery, Saved } from "../../shared/memex.ts";
import type { TagCount } from "../../shared/notes.ts";
import type { BlobStore } from "../archive/ports.ts";

export type MemexErrorCode = "not_found" | "version_conflict" | "invalid" | "too_large";

// Thrown by the repo and routes; app.ts maps `code` to an HTTP status. version_conflict: detail
// is the current version.
export class MemexError extends Error {
  code: MemexErrorCode;
  detail?: unknown;
  constructor(code: MemexErrorCode, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface MemexRepo {
  createPage(page: { title: string; tags: string[]; doc: PageDoc }): Promise<MemexPage>;
  getPage(id: string): Promise<MemexPage | null>;
  listPages(query: MemexPageListQuery): Promise<MemexPageList>;
  // Throws MemexError: not_found, version_conflict. Rebuilds the page's asset uses from `doc`.
  savePage(id: string, save: { title: string; doc: PageDoc; baseVersion: number }): Promise<Saved>;
  // null if the page doesn't exist.
  setTags(id: string, tags: string[]): Promise<MemexPage | null>;
  // false if the page doesn't exist. Its assets that no other page uses are detached.
  deletePage(id: string): Promise<boolean>;
  tagCounts(): Promise<TagCount[]>;

  // Records uploaded bytes (detached until a page uses them). Uploading known bytes again
  // restarts their grace period if they are still detached.
  registerAsset(asset: { sha256: string; mime: AssetMime; size: number }): Promise<Asset>;
  getAsset(sha256: string): Promise<Asset | null>;
  // The subset of `shas` that has an asset row.
  existingAssets(shas: string[]): Promise<Set<string>>;
  // Deletes the rows of assets no page has used since `before`; returns their hashes (the caller
  // removes the bytes).
  deleteDetachedAssets(before: Date): Promise<string[]>;
}

export type MemexDeps = { repo: MemexRepo; blobs: BlobStore };
