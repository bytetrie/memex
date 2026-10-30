// The memex editor's state, outside React: the page doc, the undo history, the selection, the text
// box being edited and the live preview of a drag. Components read it through useStore(selector)
// (useSyncExternalStore), so a drag re-renders only the elements that move: an element keeps its
// object identity until a command or a preview changes it (commands.ts).
//
// - commit(doc) records one undo step. Steps with the same `merge` key in a row (typing a number
//   into a field) become one step.
// - A drag or a resize shows through preview() and commits once, when the pointer is released.
// - Every commit, undo and redo calls onChange (the autosave marks the page dirty).

import { useSyncExternalStore } from "react";
import type { PageDoc, PageElement } from "../../../../../src/shared/memex-doc.ts";
import type { Guides } from "../canvas/snap.ts";

const HISTORY = 200;
const MERGE_MS = 1500;

// A drag or resize changes only where elements are and how big.
export type Geometry = Partial<Pick<PageElement, "x" | "y" | "w" | "h">>;
export type Preview = { elements: ReadonlyMap<string, Geometry>; guides: Guides };

export type EditorState = {
  doc: PageDoc;
  selection: readonly string[];
  // The text box whose editor is open.
  editing: string | null;
  preview: Preview | null;
  canUndo: boolean;
  canRedo: boolean;
};

export type DocStore = ReturnType<typeof createDocStore>;

const noGuides: Guides = { xs: [], ys: [] };

export function createDocStore(initial: PageDoc, onChange: () => void = () => undefined) {
  let state: EditorState = { doc: initial, selection: [], editing: null, preview: null, canUndo: false, canRedo: false };
  let past: PageDoc[] = [];
  let future: PageDoc[] = [];
  let lastMerge: { key: string; at: number } | null = null;
  // Elements with the preview applied, made once per preview so selectors see stable objects.
  let previewed = new Map<string, PageElement>();
  // Elements by id, rebuilt when the doc changes.
  let indexed: { doc: PageDoc; byId: Map<string, PageElement> } = { doc: initial, byId: new Map(initial.elements.map((e) => [e.id, e])) };
  const byId = () => {
    if (indexed.doc !== state.doc) indexed = { doc: state.doc, byId: new Map(state.doc.elements.map((e) => [e.id, e])) };
    return indexed.byId;
  };
  const listeners = new Set<() => void>();

  const set = (next: Partial<EditorState>) => {
    state = { ...state, ...next, canUndo: past.length > 0, canRedo: future.length > 0 };
    for (const l of listeners) l();
  };

  // The selection without elements that no longer exist.
  const keepExisting = (doc: PageDoc, ids: readonly string[]) => {
    const present = new Set(doc.elements.map((e) => e.id));
    const kept = ids.filter((id) => present.has(id));
    return kept.length === ids.length ? ids : kept;
  };

  return {
    getState: () => state,
    getDoc: () => state.doc,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    commit(doc: PageDoc, opts: { merge?: string; select?: readonly string[] } = {}) {
      const changed = doc !== state.doc;
      if (!changed && !opts.select) return;
      if (changed) {
        const now = Date.now();
        const merging = opts.merge !== undefined && lastMerge?.key === opts.merge && now - lastMerge.at < MERGE_MS && past.length > 0;
        if (!merging) past = [...past.slice(-(HISTORY - 1)), state.doc];
        future = [];
        lastMerge = opts.merge === undefined ? null : { key: opts.merge, at: now };
      }
      previewed = new Map();
      set({ doc, preview: null, selection: keepExisting(doc, opts.select ?? state.selection) });
      if (changed) onChange();
    },

    undo() {
      const prev = past.at(-1);
      if (!prev) return;
      past = past.slice(0, -1);
      future = [state.doc, ...future];
      lastMerge = null;
      set({ doc: prev, preview: null, editing: null, selection: keepExisting(prev, state.selection) });
      onChange();
    },

    redo() {
      const [next, ...rest] = future;
      if (!next) return;
      future = rest;
      past = [...past, state.doc];
      lastMerge = null;
      set({ doc: next, preview: null, editing: null, selection: keepExisting(next, state.selection) });
      onChange();
    },

    select(ids: readonly string[]) {
      if (ids.length === state.selection.length && ids.every((id, i) => id === state.selection[i])) return;
      set({ selection: ids, editing: state.editing && ids.includes(state.editing) ? state.editing : null });
    },

    edit(id: string | null) {
      if (id === state.editing) return;
      set({ editing: id, selection: id ? [id] : state.selection });
    },

    preview(changes: ReadonlyMap<string, Geometry> | null, guides: Guides = noGuides) {
      if (!changes) {
        if (!state.preview) return;
        previewed = new Map();
        set({ preview: null });
        return;
      }
      previewed = new Map();
      for (const e of state.doc.elements) {
        const change = changes.get(e.id);
        if (change) previewed.set(e.id, { ...e, ...change });
      }
      set({ preview: { elements: changes, guides } });
    },

    // An element as it shows now (with the preview applied).
    element: (id: string): PageElement | undefined => previewed.get(id) ?? byId().get(id),
  };
}

export function useStore<T>(store: DocStore, selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

// One element as shown (preview applied); re-renders only when that element changes.
export function useElement(store: DocStore, id: string): PageElement | undefined {
  return useSyncExternalStore(store.subscribe, () => store.element(id), () => store.element(id));
}
