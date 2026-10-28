// "The list of pages may have changed" (a save, new tags, a deleted page). The pane listens and
// refetches its list itself. Not router.invalidate(): every router re-render is treated as a
// navigation, which scrolls the window back to the top (TanStack Router's scroll reset).

const listeners = new Set<() => void>();

export function pagesChanged(): void {
  for (const listener of listeners) listener();
}

export function onPagesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
