// One entry in a list: title link, type, tags (each searches for that #tag), date. Entries with
// thumbnails show the small still (thumb.*), which turns into the animated preview (preview.*) while
// the card is hovered or has focus, unless the browser asks for reduced motion. The preview is only
// requested on the first hover.

import { Badge, Card, Text } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useState } from "react";

import type { EntrySummary } from "../../../../src/shared/archive.ts";
import { fileUrl } from "../../api.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import classes from "./Archive.module.css";
import { formatDate, tagToken } from "./format.ts";
import { archiveTypeUi } from "./types/index.ts";

export function EntryCard({ entry }: { entry: EntrySummary }) {
  const still = entry.thumbnails.find((t) => t.name.startsWith("thumb."));
  const animated = entry.thumbnails.find((t) => t.name.startsWith("preview."));
  const reduceMotion = useReducedMotion();
  const [moving, setMoving] = useState(false);
  const canMove = animated !== undefined && !reduceMotion;
  const start = () => { if (canMove) setMoving(true); };
  const stop = () => { setMoving(false); };

  const text = (
    <div className={classes.cardText}>
      <AnchorLink to="/archive/e/$entryId" params={{ entryId: entry.id }} fw={700} size="sm" className={classes.cardTitle}>
        {entry.title}
      </AnchorLink>
      <div className={classes.meta}>
        <Badge size="sm" variant="light" leftSection={<Icon name={archiveTypeUi[entry.type].icon} />}>
          {archiveTypeUi[entry.type].label}
        </Badge>
        {entry.tags.map((tag) => (
          <AnchorLink key={tag} to="/archive" search={{ q: tagToken(tag) }} size="xs" aria-label={`Tag ${tag}`}>
            <Icon name="tag" /> {tag}
          </AnchorLink>
        ))}
        <Text size="xs" c="dimmed">
          {formatDate(entry.createdAt)} · {entry.fileCount} {entry.fileCount === 1 ? "file" : "files"}
        </Text>
      </div>
    </div>
  );

  if (!still) {
    return (
      <Card component="li" withBorder padding="xs">
        {text}
      </Card>
    );
  }
  return (
    <Card component="li" withBorder padding="xs" onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop}>
      <div className={classes.cardBody}>
        <img
          className={classes.cardThumb}
          src={fileUrl(entry.id, moving && animated ? animated.name : still.name)}
          alt={`${moving ? "Animated preview" : "Thumbnail"} of ${entry.title}`}
          loading="lazy"
        />
        {text}
      </div>
    </Card>
  );
}
