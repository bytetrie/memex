// "The list of memex pages may have changed" (a save, new tags, a deleted page). The pane
// refetches its list itself, not through router.invalidate() (which scrolls to the top; see
// notes/events.ts).

const listeners = new Set<() => void>();

export function memexPagesChanged(): void {
  for (const listener of listeners) listener();
}

export function onMemexPagesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
