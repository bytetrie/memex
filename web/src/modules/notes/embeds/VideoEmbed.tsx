// "video" entries in a page: the archive's own player (Player.tsx), plus what the block keeps:
// - "Resume at …": where this block's video was left, remembered per browser (videoPosition.ts);
// - bookmarks: labelled times stored on the block (attrs.bookmarks), saved with the page.

import { ActionIcon, Button, Group, TextInput, Title, Tooltip } from "@mantine/core";
import { useId, useState, type ReactElement } from "react";
import type { VideoBookmark } from "../../../../../src/shared/notes-doc.ts";
import { Icon } from "../../../icons/Icon.tsx";
import { formatDuration } from "../../archive/format.ts";
import { playlistUrl, seekTo, usePlayer, VideoPlayer } from "../../archive/types/video/Player.tsx";
import type { EmbedProps } from "./index.ts";
import { useResumePosition } from "./videoPosition.ts";
import classes from "./VideoEmbed.module.css";

const LABEL_MAX = 200;

// What the inline label field is doing: adding a bookmark at `t`, or renaming the one at `index`.
type Editing = { kind: "add"; t: number } | { kind: "rename"; index: number };

const defaultLabel = (t: number) => `Bookmark at ${formatDuration(t)}`;

export function VideoEmbed({ entry, block }: EmbedProps): ReactElement {
  const player = usePlayer(playlistUrl(entry.id));
  const { resumeAt, dismiss } = useResumePosition(player.videoRef, block.positionKey);
  const { bookmarks, setBookmarks } = block;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [label, setLabel] = useState("");
  const headingId = useId();

  const jump = (t: number) => {
    const video = player.videoRef.current;
    if (video) seekTo(video, t);
  };

  const startAdd = () => {
    const t = player.videoRef.current?.currentTime ?? 0;
    setEditing({ kind: "add", t });
    setLabel(defaultLabel(t));
  };

  const startRename = (index: number, mark: VideoBookmark) => {
    setEditing({ kind: "rename", index });
    setLabel(mark.label);
  };

  const save = () => {
    if (!editing) return;
    if (editing.kind === "add") {
      setBookmarks([...bookmarks, { t: editing.t, label: label.trim() || defaultLabel(editing.t) }]);
    } else {
      setBookmarks(bookmarks.map((b, i) => (i === editing.index ? { ...b, label: label.trim() || b.label } : b)));
    }
    setEditing(null);
  };

  const remove = (index: number) => {
    setBookmarks(bookmarks.filter((_, i) => i !== index));
    setEditing(null);
  };

  return (
    <>
      <VideoPlayer entry={entry} player={player} />
      <Group gap="xs" mt="xs">
        {resumeAt !== null && (
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              dismiss();
              jump(resumeAt);
            }}
          >
            Resume at {formatDuration(resumeAt)}
          </Button>
        )}
        <Button size="xs" variant="default" leftSection={<Icon name="plus" />} onClick={startAdd}>
          Add bookmark
        </Button>
      </Group>

      {editing && (
        <form
          className={classes.form}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <TextInput
            className={classes.labelField}
            size="xs"
            label={editing.kind === "add" ? `Bookmark label (at ${formatDuration(editing.t)})` : "Bookmark label"}
            value={label}
            maxLength={LABEL_MAX}
            autoFocus
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setLabel(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
          <Button size="xs" type="submit">
            Save
          </Button>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              setEditing(null);
            }}
          >
            Cancel
          </Button>
        </form>
      )}

      {bookmarks.length > 0 && (
        <section aria-labelledby={headingId} className={classes.bookmarks}>
          <Title order={4} size="h6" id={headingId}>
            Bookmarks
          </Title>
          <ul className={classes.list}>
            {bookmarks.map((mark, i) => (
              <li key={`${String(mark.t)}-${mark.label}`} className={classes.item}>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  className={classes.jump}
                  classNames={{ inner: classes.jumpInner, label: classes.jumpLabel }}
                  aria-label={`Jump to ${formatDuration(mark.t)}: ${mark.label}`}
                  onClick={() => {
                    jump(mark.t);
                  }}
                >
                  <span className={classes.time}>{formatDuration(mark.t)}</span>
                  <span className={classes.label}>{mark.label}</span>
                </Button>
                <Tooltip label="Rename">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`Rename bookmark ${mark.label}`}
                    onClick={() => {
                      startRename(i, mark);
                    }}
                  >
                    <Icon name="pencil" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`Delete bookmark ${mark.label}`}
                    onClick={() => {
                      remove(i);
                    }}
                  >
                    <Icon name="trash" />
                  </ActionIcon>
                </Tooltip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
