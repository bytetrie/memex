// An archive entry shown in a page: a block atom storing `entryId` (archive refs are derived from
// it when the page is saved) and, for videos, `bookmarks`. A React node view, since embeds are rich
// (a video player); everything heavy sits in EmbedBlock, memoised on the entry id and the block's
// state, so typing, selection changes and edits elsewhere never re-render it, and a video keeps
// playing. Changing bookmarks re-renders it in place (updateAttributes keeps the node view).
// Events inside the body ([data-embed-body]) belong to the embed, not to the editor; clicking the
// header selects the block, the editor's drag handle moves it.

import { Text } from "@mantine/core";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { memo, useCallback, useMemo, useRef, type ReactElement } from "react";
import { NOTE_NODES, parseBookmarks, type VideoBookmark } from "../../../../../../src/shared/notes-doc.ts";
import { AnchorLink } from "../../../../components/AnchorLink.tsx";
import { Icon } from "../../../../icons/Icon.tsx";
import { archiveTypeUi } from "../../../archive/types/index.ts";
import { embedUi, type EmbedBlockState } from "../../embeds/index.ts";
import { useEntry } from "../../embeds/entryCache.ts";
import { useNearViewport } from "../../useNearViewport.ts";
import { positionKey } from "../../embeds/videoPosition.ts";
import { strAttr, type NotesEditorContext } from "../context.ts";
import classes from "../Editor.module.css";

export const insideBody = (event: Event) => event.target instanceof Element && event.target.closest("[data-embed-body]") !== null;

const EmbedBlock = memo(function EmbedBlock({ entryId, block }: { entryId: string | null; block: EmbedBlockState }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const state = useEntry(entryId ?? "", near && entryId !== null);
  const entry = state.status === "ready" ? state.entry : null;
  const ui = entry ? archiveTypeUi[entry.type] : null;
  const Body = entry ? embedUi[entry.type] : null;
  return (
    <div ref={ref} className={classes.embed}>
      <div className={classes.embedHead}>
        <Icon name={ui?.icon ?? "box"} />
        <Text span size="sm" fw={500} className={classes.embedTitle}>
          {entry?.title ?? "Archive entry"}
        </Text>
        {entryId && (
          <AnchorLink size="sm" to="/archive/e/$entryId" params={{ entryId }} data-embed-body>
            Open in archive
          </AnchorLink>
        )}
      </div>
      <div className={classes.embedBody} data-embed-body>
        {entryId === null || state.status === "missing" ? (
          <Text c="dimmed">This archive entry no longer exists.</Text>
        ) : state.status === "error" ? (
          <Text c="red">The entry didn't load: {state.message}</Text>
        ) : entry && Body ? (
          <Body entry={entry} block={block} />
        ) : (
          <Text c="dimmed">Loading…</Text>
        )}
      </div>
    </div>
  );
});

function ArchiveEmbedView({ ctx, node, selected, updateAttributes }: ReactNodeViewProps & { ctx: NotesEditorContext }): ReactElement {
  // Stable props for the memoised block: the parsed bookmarks change only with the attribute, and
  // Tiptap creates updateAttributes once per node view.
  const raw: unknown = node.attrs.bookmarks;
  const bookmarks = useMemo(() => parseBookmarks(raw), [raw]);
  const setBookmarks = useCallback(
    (next: VideoBookmark[]) => {
      updateAttributes({ bookmarks: parseBookmarks(next) });
    },
    [updateAttributes],
  );
  const blockId = strAttr(node, "id");
  const key = blockId ? positionKey(ctx.pageId, blockId) : null;
  const block = useMemo<EmbedBlockState>(() => ({ positionKey: key, bookmarks, setBookmarks }), [key, bookmarks, setBookmarks]);
  return (
    <NodeViewWrapper className={classes.atomBlock} data-selected={selected ? "" : undefined}>
      <EmbedBlock entryId={strAttr(node, "entryId")} block={block} />
    </NodeViewWrapper>
  );
}

function parseBookmarksAttr(el: HTMLElement): VideoBookmark[] | null {
  const json = el.getAttribute("data-bookmarks");
  if (!json) return null;
  try {
    return parseBookmarks(JSON.parse(json));
  } catch {
    return null;
  }
}

export const archiveEmbedNode = (ctx: NotesEditorContext) => {
  const View = (props: ReactNodeViewProps): ReactElement => <ArchiveEmbedView {...props} ctx={ctx} />;
  return Node.create({
    name: NOTE_NODES.archiveEmbed,
    group: "block",
    atom: true,
    // Not natively draggable: holding the mouse down inside (drawing, scrubbing a video) must not
    // drag the block. It moves with the editor's drag handle like any block.
    draggable: false,
    selectable: true,
    addAttributes() {
      return {
        entryId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-entry-id"), renderHTML: (a: Record<string, unknown>) => ({ "data-entry-id": a.entryId }) },
        // Video bookmarks, [{ t, label }] (notes-doc.ts); kept as JSON when the block is copied.
        bookmarks: {
          default: null,
          parseHTML: parseBookmarksAttr,
          renderHTML: (a: Record<string, unknown>) => {
            const marks = parseBookmarks(a.bookmarks);
            return marks.length > 0 ? { "data-bookmarks": JSON.stringify(marks) } : {};
          },
        },
      };
    },
    parseHTML() {
      return [{ tag: `div[data-type="${NOTE_NODES.archiveEmbed}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": NOTE_NODES.archiveEmbed })];
    },
    renderText({ node }) {
      return `archive:${strAttr(node, "entryId") ?? ""}`;
    },
    addNodeView() {
      return ReactNodeViewRenderer(View, { stopEvent: ({ event }) => insideBody(event) });
    },
  });
};
