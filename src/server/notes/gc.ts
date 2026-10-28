// Notes' share of the hourly sweep (server.ts): drawings no page has shown for a day.
// The day lets undo bring a deleted drawing block back with its scene.

import type { Logger } from "../types.ts";
import type { NotesDeps } from "./ports.ts";

export const DRAWING_GRACE_MS = 24 * 60 * 60 * 1000;

export async function sweepNotes(deps: NotesDeps & { log: Logger }, graceMs = DRAWING_GRACE_MS): Promise<number> {
  const drawings = await deps.repo.deleteDetachedDrawings(new Date(Date.now() - graceMs));
  if (drawings) deps.log.info({ event: "notes.gc", drawings }, "gc");
  return drawings;
}
