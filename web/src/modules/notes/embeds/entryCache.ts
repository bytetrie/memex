// Archive entries as embeds show them, fetched once per session. An entry's files never change,
// so what is rendered from them can be kept; its title and tags can, which is why this cache
// lives only as long as the tab. A failed fetch is forgotten, so the next mount retries.

import { useEffect, useState } from "react";
import type { Entry } from "../../../../../src/shared/archive.ts";
import { getEntry } from "../../../api.ts";

const entries = new Map<string, Promise<Entry | null>>();

export function loadEntry(id: string): Promise<Entry | null> {
  let found = entries.get(id);
  if (!found) {
    found = getEntry(id).catch((err: unknown) => {
      entries.delete(id);
      throw err;
    });
    entries.set(id, found);
  }
  return found;
}

export type EntryState = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; entry: Entry };

export function useEntry(id: string, enabled: boolean): EntryState {
  const [state, setState] = useState<EntryState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadEntry(id).then(
      (entry) => {
        if (!cancelled) setState(entry ? { status: "ready", entry } : { status: "missing" });
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, enabled]);
  return state;
}
