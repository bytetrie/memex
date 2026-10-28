// Page body of a "video" entry: the player (Player.tsx, with English captions), the details,
// the transcript (each line seeks the video), then the files.

import { Text, Title, UnstyledButton } from "@mantine/core";
import { useEffect, useState, type ReactElement } from "react";
import { z } from "zod";
import { transcriptCues, type Cue } from "../../../../../../src/shared/vtt.ts";
import { getFileText } from "../../../../api.ts";
import classes from "../../Archive.module.css";
import { formatDuration } from "../../format.ts";
import { GenericView } from "../../GenericView.tsx";
import type { ViewProps } from "../index.ts";
import { playlistUrl, seekTo, usePlayer, VideoPlayer } from "./Player.tsx";

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
  const player = usePlayer(playlistUrl(entry.id));
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
    const video = player.videoRef.current;
    if (video) seekTo(video, seconds);
  };

  const details = [
    m.channel,
    m.uploadDate ? `uploaded ${m.uploadDate}` : null,
    m.duration ? formatDuration(m.duration) : null,
    m.width && m.height ? `${String(m.width)}×${String(m.height)}` : null,
  ].filter((d): d is string => Boolean(d));

  return (
    <div className={classes.videoView}>
      <VideoPlayer entry={entry} player={player} />
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
