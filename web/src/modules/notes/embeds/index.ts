// How each archive type shows inside a note page. Typed Record<ArchiveTypeId, ...>: after adding an
// archive type, tsc fails here until it has an embed (AGENTS.md "Add an archive embed for a type").
// An embed gets the whole entry, mounts only near the viewport and stays mounted (ArchiveEmbed.tsx).

import type { ComponentType } from "react";
import type { Entry } from "../../../../../src/shared/archive.ts";
import type { ArchiveTypeId } from "../../../../../src/shared/archive-types.ts";
import type { VideoBookmark } from "../../../../../src/shared/notes-doc.ts";
import { TextEmbed } from "./TextEmbed.tsx";
import { VideoEmbed } from "./VideoEmbed.tsx";

// The embed's own block: the key a video remembers its position under (per browser; null until the
// block has an id) and its bookmarks (attrs.bookmarks, saved with the page; setting them is an
// editor change, so it autosaves and undoes like any edit).
export type EmbedBlockState = {
  positionKey: string | null;
  bookmarks: VideoBookmark[];
  setBookmarks: (next: VideoBookmark[]) => void;
};

export type EmbedProps = { entry: Entry; block: EmbedBlockState };

export const embedUi: Record<ArchiveTypeId, ComponentType<EmbedProps>> = {
  file: TextEmbed,
  text: TextEmbed,
  video: VideoEmbed,
};
