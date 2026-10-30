// Where a video block was left playing, remembered per browser (localStorage) by page and block, so
// a refresh, a visit to another page or a moved block offers "Resume at …". It is not in the doc:
// watching never saves the page. Bookmarks are in the doc (parseBookmarks in notes-doc.ts).

import { useEffect, useState, type RefObject } from "react";
import { z } from "zod";

// Nothing is kept near the start (just opened) or near the end (finished).
export const MIN_RESUME_S = 5;
export const END_MARGIN_S = 10;
const SAVE_EVERY_MS = 3000;

const StoredSchema = z.object({ t: z.number().min(0), at: z.number() });

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const positionKey = (pageId: string, blockId: string) => `memex.notes.video:${pageId}:${blockId}`;

// localStorage can be missing or throw (blocked site data); resuming is only a convenience.
function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// The position worth remembering for a playback time, or null to forget it.
export function positionToKeep(t: number, duration: number): number | null {
  if (!Number.isFinite(t) || t < MIN_RESUME_S) return null;
  if (Number.isFinite(duration) && duration > 0 && t >= duration - END_MARGIN_S) return null;
  return t;
}

export function readPosition(key: string, store = browserStore()): number | null {
  try {
    const raw = store?.getItem(key) ?? null;
    if (raw === null) return null;
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.t >= MIN_RESUME_S ? parsed.data.t : null;
  } catch {
    return null;
  }
}

export function rememberPosition(key: string, t: number, duration: number, store = browserStore()): void {
  const keep = positionToKeep(t, duration);
  try {
    if (keep === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify({ t: keep, at: Date.now() }));
  } catch {
    // full or blocked storage
  }
}

// Follows one video's playback and stores where it is. Only a video that has played and still has
// its media counts: nothing is written before the first play (loading a page never overwrites the
// stored position), and once the player is torn down (hls.js's destroy() reloads the element, back
// at 0 with no duration) the last good reading is what gets stored, not that 0, which would erase it.
export function createPositionTracker(key: string, store = browserStore()) {
  let started = false;
  let latest: { t: number; duration: number } | null = null;
  let lastWrite = 0;
  const write = () => {
    if (latest) rememberPosition(key, latest.t, latest.duration, store);
  };
  return {
    played() {
      started = true;
    },
    // A reading from the element; `ready` is whether it still has its media (readyState >= metadata).
    observe(t: number, duration: number, ready: boolean) {
      if (started && ready) latest = { t, duration };
    },
    // Stores the latest reading: at most every few seconds unless `now` (pause, seek, leaving).
    save(now = false) {
      const at = Date.now();
      if (!now && at - lastWrite < SAVE_EVERY_MS) return;
      lastWrite = at;
      write();
    },
  };
}

// Remembers the video's position while it plays (every few seconds, on pause, seek, end, leaving
// the page or unmounting) and returns where to offer resuming: what was stored when the block
// mounted, until playback reaches it or dismiss() is called.
export function useResumePosition(videoRef: RefObject<HTMLVideoElement | null>, key: string | null) {
  const [offer, setOffer] = useState(() => ({ key, at: key ? readPosition(key) : null }));
  let current = offer;
  if (offer.key !== key) {
    // The block got its id after mounting: read again (adjusting state while rendering).
    current = { key, at: key ? readPosition(key) : null };
    setOffer(current);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !key) return;
    const tracker = createPositionTracker(key);
    const observe = () => {
      tracker.observe(video.currentTime, video.duration, video.readyState >= HTMLMediaElement.HAVE_METADATA);
    };
    const saveNow = () => {
      observe();
      tracker.save(true);
    };
    const onPlay = () => {
      tracker.played();
      observe();
    };
    const onTime = () => {
      setOffer((o) => (o.at !== null && video.currentTime >= o.at ? { ...o, at: null } : o));
      observe();
      tracker.save();
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTime);
    for (const name of ["pause", "seeked", "ended"]) video.addEventListener(name, saveNow);
    window.addEventListener("pagehide", saveNow);
    return () => {
      // No reading here: the player may already be torn down (its effect cleans up first).
      tracker.save(true);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTime);
      for (const name of ["pause", "seeked", "ended"]) video.removeEventListener(name, saveNow);
      window.removeEventListener("pagehide", saveNow);
    };
  }, [videoRef, key]);

  const dismiss = () => {
    setOffer((o) => ({ ...o, at: null }));
  };
  return { resumeAt: current.at, dismiss };
}
