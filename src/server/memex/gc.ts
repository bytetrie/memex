// The memex's share of the hourly sweep (server.ts): assets no page has used for a day (the day
// lets undo bring a deleted element back), files in the store without a row (a crash between
// writing and registering, or a refused upload whose delete failed) and stale upload temp files.

import type { MemexGcResult } from "../../shared/memex.ts";
import type { Logger } from "../types.ts";
import type { MemexDeps } from "./ports.ts";

export const ASSET_GRACE_MS = 24 * 60 * 60 * 1000;

export async function sweepMemex(deps: MemexDeps & { log: Logger }, graceMs = ASSET_GRACE_MS): Promise<MemexGcResult> {
  const { repo, blobs, log } = deps;
  const cutoffMs = Date.now() - graceMs;
  const result: MemexGcResult = { assets: 0, strays: 0, tmp: 0 };

  for (const sha256 of await repo.deleteDetachedAssets(new Date(cutoffMs))) {
    await blobs.delete(sha256);
    result.assets++;
  }

  let batch: string[] = [];
  const flush = async () => {
    const known = await repo.existingAssets(batch);
    for (const sha256 of batch.filter((s) => !known.has(s))) {
      await blobs.delete(sha256);
      result.strays++;
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
  if (result.assets || result.strays || result.tmp) log.info({ event: "memex.gc", ...result }, "gc");
  return result;
}
