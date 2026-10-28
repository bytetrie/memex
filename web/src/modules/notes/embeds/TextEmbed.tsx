// "text" and "file" entries in a page: the start of their text, with a link to the whole entry.

import { Text } from "@mantine/core";
import { useEffect, useState, type ReactElement } from "react";
import { getFileText } from "../../../api.ts";
import classes from "../Notes.module.css";
import type { EmbedProps } from "./index.ts";

const EXCERPT_BYTES = 4096;

// The text an excerpt is read from: the first original file.
const textFile = (entry: EmbedProps["entry"]) => entry.files.find((f) => f.role === "original")?.name;

// Excerpts by entry and file: the files are immutable.
const excerpts = new Map<string, Promise<string>>();

export function TextEmbed({ entry }: EmbedProps): ReactElement {
  const name = textFile(entry);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!name) return;
    const key = `${entry.id}/${name}`;
    let excerpt = excerpts.get(key);
    if (!excerpt) {
      excerpt = getFileText(entry.id, name, EXCERPT_BYTES);
      excerpts.set(key, excerpt);
    }
    let cancelled = false;
    excerpt.then(
      (t) => {
        if (!cancelled) setText(t);
      },
      () => {
        excerpts.delete(key);
        if (!cancelled) setText("");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entry.id, name]);

  if (!name) return <Text c="dimmed">This entry has no text.</Text>;
  if (text === null) return <Text c="dimmed">Loading…</Text>;
  const cut = new TextEncoder().encode(text).length >= EXCERPT_BYTES;
  return (
    <Text component="pre" size="sm" className={classes.excerpt}>
      {text.trimEnd()}
      {cut ? "\n…" : ""}
    </Text>
  );
}
