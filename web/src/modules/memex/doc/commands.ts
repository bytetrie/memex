// Edits of a memex page doc, as pure functions: each returns a new doc and keeps every element it
// doesn't change as the same object, so the editor re-renders only what changed (store.ts) and
// the undo history shares unchanged parts.

import { type Format, type Grid, type PageDoc, type PageElement } from "../../../../../src/shared/memex-doc.ts";

// A change to some of an element's fields (any kind's, but never its id or kind).
type PatchOf<T> = T extends unknown ? Partial<Omit<T, "id" | "kind">> : never;
export type ElementPatch = PatchOf<PageElement>;
export type Reorder = "forward" | "backward" | "front" | "back";

export const newId = () => crypto.randomUUID();

export function addElements(doc: PageDoc, elements: PageElement[]): PageDoc {
  return { ...doc, elements: [...doc.elements, ...elements] };
}

// Applies `patch` (or what `fn` returns) to the elements in `ids`.
export function updateElements(doc: PageDoc, ids: readonly string[], patch: ElementPatch | ((e: PageElement) => ElementPatch)): PageDoc {
  const set = new Set(ids);
  const elements: PageElement[] = [];
  let changed = false;
  for (const e of doc.elements) {
    const p = set.has(e.id) ? (typeof patch === "function" ? patch(e) : patch) : null;
    const before: Record<string, unknown> = e;
    if (!p || Object.entries(p).every(([k, v]) => Object.is(v, before[k]))) {
      elements.push(e);
      continue;
    }
    changed = true;
    // A patch never carries kind or id, so the element keeps its own kind's shape.
    elements.push({ ...e, ...p });
  }
  return changed ? { ...doc, elements } : doc;
}

// Puts `elements` where the element `id` was in the z-order (the first takes its place, the others
// go right above it). Used when content fills an empty frame.
export function replaceElement(doc: PageDoc, id: string, elements: PageElement[]): PageDoc {
  const i = doc.elements.findIndex((e) => e.id === id);
  if (i === -1) return addElements(doc, elements);
  return { ...doc, elements: [...doc.elements.slice(0, i), ...elements, ...doc.elements.slice(i + 1)] };
}

export function removeElements(doc: PageDoc, ids: readonly string[]): PageDoc {
  const set = new Set(ids);
  return { ...doc, elements: doc.elements.filter((e) => !set.has(e.id)) };
}

// Copies of the elements in `ids`, offset a little, placed right above their originals' top one.
export function duplicateElements(doc: PageDoc, ids: readonly string[], offset = 9, makeId: () => string = newId): { doc: PageDoc; ids: string[] } {
  const set = new Set(ids);
  const copies = doc.elements.filter((e) => set.has(e.id)).map((e) => ({ ...e, id: makeId(), x: e.x + offset, y: e.y + offset, locked: false }));
  if (copies.length === 0) return { doc, ids: [] };
  return { doc: addElements(doc, copies), ids: copies.map((c) => c.id) };
}

// Moves the elements in `ids` one step or all the way up (forward, front) or down the z-order.
export function reorderElements(doc: PageDoc, ids: readonly string[], how: Reorder): PageDoc {
  const set = new Set(ids);
  const picked = doc.elements.filter((e) => set.has(e.id));
  const rest = doc.elements.filter((e) => !set.has(e.id));
  if (picked.length === 0) return doc;
  if (how === "front") return { ...doc, elements: [...rest, ...picked] };
  if (how === "back") return { ...doc, elements: [...picked, ...rest] };
  const elements = [...doc.elements];
  // Step each picked element past its neighbour, starting from the end it moves towards.
  const order = how === "forward" ? [...elements.keys()].reverse() : [...elements.keys()];
  for (const i of order) {
    const e = elements[i];
    const j = how === "forward" ? i + 1 : i - 1;
    const other = elements[j];
    if (!e || !other || !set.has(e.id) || set.has(other.id)) continue;
    elements[j] = e;
    elements[i] = other;
  }
  return elements.every((e, i) => e === doc.elements[i]) ? doc : { ...doc, elements };
}

export const setFormat = (doc: PageDoc, format: Partial<Format>): PageDoc => ({ ...doc, format: { ...doc.format, ...format } });
export const setGrid = (doc: PageDoc, grid: Partial<Grid>): PageDoc => ({ ...doc, grid: { ...doc.grid, ...grid } });
