// Garbage sweep: removes blobs nothing references any more (an abandoned
// upload, or the files of a deleted entry) once they are older than the grace
// period, plus stray store files, stale upload temp files, runner job folders
// left in incoming/ and finished jobs older than a week.
//
// Accepted race: if the very bytes of a blob being removed are uploaded again
// within the few milliseconds between its row and its file being deleted, the
// new upload ends up without a file. Single-user tool; the retry is the fix.

import type { GcResult } from "../../shared/archive.ts";
import type { Logger } from "../types.ts";
import type { ArchiveDeps } from "./ports.ts";

export const GC_GRACE_MS = 24 * 60 * 60 * 1000;
export const JOB_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export async function sweep(deps: ArchiveDeps & { log: Logger }, graceMs = GC_GRACE_MS): Promise<GcResult> {
  const { repo, blobs, incoming, jobs, log } = deps;
  const cutoffMs = Date.now() - graceMs;
  const result: GcResult = { blobs: [], strays: [], tmp: 0, incoming: 0, jobs: 0 };

  for (const sha256 of await repo.orphanBlobs(new Date(cutoffMs))) {
    if (await repo.deleteBlobIfUnreferenced(sha256)) {
      await blobs.delete(sha256);
      result.blobs.push(sha256);
    }
  }

  // Files on disk that never got a row (a crash between writing and registering).
  let batch: string[] = [];
  const flush = async () => {
    const known = await repo.existingBlobs(batch);
    for (const sha256 of batch.filter((s) => !known.has(s))) {
      await blobs.delete(sha256);
      result.strays.push(sha256);
    }
    batch = [];
  };
  for await (const f of blobs.list()) {
    if (f.mtimeMs >= cutoffMs) continue;
    batch.push(f.sha256);
    if (batch.length >= 500) await flush();
  }
  await flush();

  result.tmp = await blobs.sweepTmp(cutoffMs);
  // A job runs for a few hours at most (the runners' runtime_max), far less than the grace period.
  result.incoming = await incoming.sweep(cutoffMs);
  result.jobs = await jobs.deleteFinished(new Date(Date.now() - JOB_KEEP_MS));

  if (result.blobs.length || result.strays.length || result.tmp || result.incoming || result.jobs) {
    log.info(
      { event: "blob.gc", blobs: result.blobs.length, strays: result.strays.length, tmp: result.tmp, incoming: result.incoming, jobs: result.jobs },
      "gc",
    );
  }
  return result;
}
