import { describe, expect, it } from "vitest";
import { createPositionTracker, END_MARGIN_S, MIN_RESUME_S, positionKey, positionToKeep, readPosition, rememberPosition } from "./videoPosition.ts";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
    removeItem: (k: string) => {
      items.delete(k);
    },
  };
}

const key = positionKey("page-1", "block-1");

describe("video positions", () => {
  it("keeps positions past the start and before the end", () => {
    expect(positionToKeep(MIN_RESUME_S - 1, 600)).toBeNull();
    expect(positionToKeep(120, 600)).toBe(120);
    expect(positionToKeep(600 - END_MARGIN_S, 600)).toBeNull();
    expect(positionToKeep(120, Number.NaN)).toBe(120); // duration not known yet
    expect(positionToKeep(Number.NaN, 600)).toBeNull();
  });

  it("remembers a position and forgets it near the start or the end", () => {
    const store = memoryStore();
    rememberPosition(key, 75.5, 600, store);
    expect(readPosition(key, store)).toBe(75.5);
    expect(readPosition(positionKey("page-1", "other"), store)).toBeNull();
    rememberPosition(key, 595, 600, store);
    expect(readPosition(key, store)).toBeNull();
    rememberPosition(key, 75, 600, store);
    rememberPosition(key, 1, 600, store);
    expect(store.items.size).toBe(0);
  });

  it("ignores what doesn't parse and storage that throws", () => {
    const store = memoryStore();
    store.items.set(key, "{not json");
    expect(readPosition(key, store)).toBeNull();
    store.items.set(key, JSON.stringify({ t: "75" }));
    expect(readPosition(key, store)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => undefined,
    };
    expect(readPosition(key, broken)).toBeNull();
    expect(() => {
      rememberPosition(key, 75, 600, broken);
    }).not.toThrow();
    expect(readPosition(key, null)).toBeNull();
  });

  it("keeps the last position when the player is torn down", () => {
    const store = memoryStore();
    rememberPosition(key, 300, 600, store);
    const tracker = createPositionTracker(key, store);
    tracker.observe(0, 600, true); // loaded, never played: nothing is written
    tracker.save(true);
    expect(readPosition(key, store)).toBe(300);
    tracker.played();
    tracker.observe(120, 600, true);
    tracker.save(true);
    expect(readPosition(key, store)).toBe(120);
    // hls.js's destroy() reloads the element: back at 0, no metadata.
    tracker.observe(0, Number.NaN, false);
    tracker.save(true);
    expect(readPosition(key, store)).toBe(120);
  });

  it("keeps each block's position apart", () => {
    const store = memoryStore();
    const a = createPositionTracker(positionKey("page-1", "a"), store);
    const b = createPositionTracker(positionKey("page-1", "b"), store);
    a.played();
    a.observe(60, 600, true);
    a.save(true);
    b.played();
    b.observe(200, 600, true);
    b.save(true);
    expect(readPosition(positionKey("page-1", "a"), store)).toBe(60);
    expect(readPosition(positionKey("page-1", "b"), store)).toBe(200);
  });
});
