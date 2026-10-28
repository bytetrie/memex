// The HLS player of a "video" entry (hls.js, loaded only when a player mounts), with English
// captions. Used by the entry page (View.tsx) and by archive embeds in notes.

import { Alert } from "@mantine/core";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Entry } from "../../../../../../src/shared/archive.ts";
import { fileUrl } from "../../../../api.ts";
import classes from "../../Archive.module.css";

const PLAYLIST = "hls/index.m3u8";

export const playlistUrl = (entryId: string) => fileUrl(entryId, PLAYLIST);

export function usePlayer(src: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let destroy = () => {};
    let cancelled = false;
    import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError(`The video can't be played (${data.details}).`);
          });
          hls.loadSource(src);
          hls.attachMedia(video);
          destroy = () => { hls.destroy(); };
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src; // Safari plays HLS itself
        } else {
          setError("This browser can't play HLS video.");
        }
      })
      .catch((err: unknown) => {
        setError(`The player didn't load: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
      destroy();
    };
  }, [src]);
  return { videoRef, error };
}

// Jumps to a time, waiting for the metadata if the stream isn't attached yet (hls.js loads lazily).
export function seekTo(video: HTMLVideoElement, seconds: number, play = true): void {
  const go = () => {
    video.currentTime = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds;
    if (play) void video.play().catch(() => undefined);
  };
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) go();
  else video.addEventListener("loadedmetadata", go, { once: true });
}

export function VideoPlayer({ entry, player }: { entry: Entry; player: ReturnType<typeof usePlayer> }): ReactElement {
  const names = new Set(entry.files.map((f) => f.name));
  const transcriptFile = entry.files.find((f) => f.mime === "text/vtt")?.name;
  return (
    <>
      {names.has(PLAYLIST) ? (
        <video
          ref={player.videoRef}
          className={classes.video}
          controls
          preload="metadata"
          poster={names.has("poster.jpg") ? fileUrl(entry.id, "poster.jpg") : undefined}
          aria-label={`Video: ${entry.title}`}
        >
          {transcriptFile && <track kind="subtitles" srcLang="en" label="English" src={fileUrl(entry.id, transcriptFile)} />}
        </video>
      ) : (
        <Alert color="red">This entry has no video stream.</Alert>
      )}
      {player.error && (
        <Alert color="red" title="Playback">
          {player.error}
        </Alert>
      )}
    </>
  );
}
