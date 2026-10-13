// Page body of a "video" entry: the HLS stream in a player (hls.js, loaded only on this page),
// English captions, the details, the transcript (each line seeks the video), then the files.

import { Alert, Text, Title, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import { transcriptCues, type Cue } from "../../../../../../src/shared/vtt.ts";
import { fileUrl, getFileText } from "../../../../api.ts";
import classes from "../../Archive.module.css";
import { formatDuration } from "../../format.ts";
import { GenericView } from "../../GenericView.tsx";
import type { ViewProps } from "../index.ts";

const PLAYLIST = "hls/index.m3u8";
const TRANSCRIPT_MAX_BYTES = 16 * 1024 ** 2;

// The entry's meta as the video type writes it (src/server/archive/types/video.ts); every field optional.
const MetaSchema = z.object({
  channel: z.string().nullish(),
  uploadDate: z.string().nullish(),
  duration: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  subtitles: z.enum(["manual", "automatic", "none"]).nullish(),
});

function usePlayer(src: string) {
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

function Transcript({ cues, onSeek }: { cues: Cue[]; onSeek: (seconds: number) => void }): ReactElement {
  return (
    <ol className={classes.transcript} aria-label="Transcript">
      {cues.map((cue, i) => (
        <li key={`${String(cue.start)}-${String(i)}`} className={classes.cue}>
          <UnstyledButton className={classes.cueTime} onClick={() => { onSeek(cue.start); }} aria-label={`Play from ${formatDuration(cue.start)}`}>
            {formatDuration(cue.start)}
          </UnstyledButton>
          <Text span size="sm">
            {cue.text}
          </Text>
        </li>
      ))}
    </ol>
  );
}

export function VideoView({ entry, previews }: ViewProps): ReactElement {
  const names = new Set(entry.files.map((f) => f.name));
  const src = fileUrl(entry.id, PLAYLIST);
  const { videoRef, error } = usePlayer(src);
  const transcriptFile = entry.files.find((f) => f.mime === "text/vtt")?.name;
  const [cues, setCues] = useState<Cue[] | null>(null);
  const meta = MetaSchema.safeParse(entry.meta);
  const m = meta.success ? meta.data : {};

  useEffect(() => {
    if (!transcriptFile) return;
    let cancelled = false;
    getFileText(entry.id, transcriptFile, TRANSCRIPT_MAX_BYTES)
      .then((vtt) => {
        if (!cancelled) setCues(transcriptCues(vtt));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => { cancelled = true; };
  }, [entry.id, transcriptFile]);

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  };

  const details = [
    m.channel,
    m.uploadDate ? `uploaded ${m.uploadDate}` : null,
    m.duration ? formatDuration(m.duration) : null,
    m.width && m.height ? `${String(m.width)}×${String(m.height)}` : null,
  ].filter((d): d is string => Boolean(d));

  return (
    <div className={classes.videoView}>
      {names.has(PLAYLIST) ? (
        <video
          ref={videoRef}
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
      {error && (
        <Alert color="red" title="Playback">
          {error}
        </Alert>
      )}
      {details.length > 0 && (
        <Text size="sm" c="dimmed">
          {details.join(" · ")}
        </Text>
      )}

      <section aria-labelledby="transcript-heading">
        <Title order={3} size="h4" id="transcript-heading" mb="xs">
          Transcript{m.subtitles === "automatic" ? " (automatic captions)" : ""}
        </Title>
        {!transcriptFile ? (
          <Text c="dimmed">The video had no English subtitles.</Text>
        ) : cues === null ? (
          <Text c="dimmed">Loading…</Text>
        ) : cues.length === 0 ? (
          <Text c="dimmed">The subtitles have no text.</Text>
        ) : (
          <Transcript cues={cues} onSeek={seek} />
        )}
      </section>

      <section aria-labelledby="video-files-heading">
        <Title order={3} size="h4" id="video-files-heading" mb="xs">
          Files
        </Title>
        <GenericView entry={entry} previews={previews} />
      </section>
    </div>
  );
}
