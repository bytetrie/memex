// Saves a page a moment after the last change, outside React: the editor marks the page dirty
// on every transaction, and nothing re-renders for it. Only the status (Saving… / Saved / a
// conflict) is observable, through subscribe/getStatus (for useSyncExternalStore), and only the
// small status component reads it.
//
// - The doc is serialised (editor.getJSON()) when a save starts, never per keystroke.
// - One save at a time; changes made meanwhile are saved right after.
// - A save that finds a newer version on the server stops autosaving ("conflict") until the
//   person reloads the page or keeps their version (overwrite).
// - flush() runs when the page is left; pagehide sends with keepalive so it survives the tab
//   closing (if the body fits in 64 KiB; beforeunload warns about unsaved changes otherwise).

import type { Doc } from "../../../../src/shared/notes-doc.ts";
import type { Saved, SavePage } from "../../../../src/shared/notes.ts";
import { VersionConflictError } from "../../api.ts";

export type SaveState = { status: "saved" | "dirty" | "saving" | "error"; error?: string } | { status: "conflict"; serverVersion: number };

type SaveFn = (input: SavePage, opts: { keepalive: boolean }) => Promise<Saved>;

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;
const KEEPALIVE_MAX = 60_000;

const idle = (fn: () => void) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
};

export type Autosave = ReturnType<typeof createAutosave>;

export function createAutosave(opts: { version: number; title: string; save: SaveFn; onSaved?: (saved: Saved) => void }) {
  let version = opts.version;
  let title = opts.title;
  let getDoc: (() => Doc) | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let state: SaveState = { status: "saved" };
  const listeners = new Set<() => void>();

  // Read through a function: it can change while a save is awaited (markDirty).
  const isDirty = () => dirty;

  const set = (next: SaveState) => {
    state = next;
    for (const l of listeners) l();
  };

  const schedule = (ms = DEBOUNCE_MS) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idle(() => void flush());
    }, ms);
  };

  async function run(keepalive: boolean): Promise<void> {
    if (!dirty || !getDoc || state.status === "conflict") return;
    dirty = false;
    set({ status: "saving" });
    const input: SavePage = { title, doc: getDoc(), baseVersion: version };
    try {
      const fits = JSON.stringify(input).length < KEEPALIVE_MAX;
      const result = await opts.save(input, { keepalive: keepalive && fits });
      version = result.version;
      opts.onSaved?.(result);
      set({ status: isDirty() ? "dirty" : "saved" });
      if (isDirty()) schedule();
    } catch (err) {
      if (err instanceof VersionConflictError) {
        dirty = true;
        set({ status: "conflict", serverVersion: err.version });
        return;
      }
      dirty = true;
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      schedule(RETRY_MS);
    }
  }

  // Saves now if anything changed; waits for a save already running first.
  async function flush(keepalive = false): Promise<void> {
    clearTimeout(timer);
    while (running) await running;
    if (!dirty) return;
    running = run(keepalive).finally(() => {
      running = null;
    });
    await running;
  }

  function markDirty() {
    dirty = true;
    if (state.status === "conflict") return;
    if (state.status !== "dirty") set({ status: "dirty" });
    schedule();
  }

  const onPageHide = () => void flush(true);
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty || running) e.preventDefault();
  };

  return {
    // The editor hands over how to read its doc once it exists. Detaching (the page is left)
    // keeps the last doc and saves it if it changed.
    attach(read: () => Doc) {
      getDoc = read;
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("beforeunload", onBeforeUnload);
        if (!dirty) return;
        try {
          const last = read();
          getDoc = () => last;
        } catch {
          getDoc = null; // the editor is already gone: nothing newer than the last save to send
          return;
        }
        void flush();
      };
    },
    markDirty,
    setTitle(next: string) {
      title = next;
      markDirty();
    },
    flush,
    // After a conflict: save this version over the newer one.
    async overwrite() {
      if (state.status !== "conflict") return;
      version = state.serverVersion;
      set({ status: "dirty" });
      dirty = true;
      await flush();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
  };
}
