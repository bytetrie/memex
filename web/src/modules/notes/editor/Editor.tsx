// The page editor (Tiptap), loaded lazily by page.tsx so Tiptap stays out of the main bundle.
//
// The editor owns the document: it gets the page's doc once and is never controlled from props
// (page.tsx keys it by page). shouldRerenderOnTransaction is off, so typing re-renders no React
// component; what needs editor state reads it through useEditorState selectors (BubbleToolbar).
// Changes only mark the autosave dirty; it serialises the doc when it saves (autosave.ts).

import { EditorContent, useEditor } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { Page } from "../../../../../src/shared/notes.ts";
import type { Doc } from "../../../../../src/shared/notes-doc.ts";
import type { Autosave } from "../../../autosave.ts";
import { ArchivePicker, createArchivePicker } from "./ArchivePicker.tsx";
import { flashBlock } from "./blockFlash.ts";
import { BubbleToolbar } from "./BubbleToolbar.tsx";
import type { NotesEditorContext } from "./context.ts";
import classes from "./Editor.module.css";
import { createExtensions } from "./extensions.ts";
import { createLinkDialog, LinkDialog } from "./LinkDialog.tsx";

const FLASH_MS = 2000;
// The drag handle touches its block: the plugin hides it as soon as the pointer leaves the editor
// for anything but the handle, so a gap between them would hide it on the way. The space between
// the grip and the text is padding inside the handle (.dragHandle), still part of its hover area.
const HANDLE_POSITION = { placement: "left-start" as const };

export default function Editor({ page, autosave }: { page: Page; autosave: Autosave<Doc> }): ReactElement {
  const navigate = useNavigate();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const picker = useMemo(createArchivePicker, []);
  const linkDialog = useMemo(createLinkDialog, []);
  // The block the drag handle currently belongs to (its position in the doc).
  const handleTarget = useRef<number | null>(null);
  const ctx = useMemo<NotesEditorContext>(
    () => ({
      pageId: page.id,
      titles: new Map(Object.entries(page.linkTitles)),
      open: (href) => void navigate({ href }),
      pickArchive: picker.pick,
      askLink: linkDialog.ask,
    }),
    [], // once per page, like the editor below (page.tsx keys this component by page)
  );

  const editor = useEditor(
    {
      extensions: createExtensions(ctx),
      content: page.doc,
      injectCSS: false, // the CSP blocks <style>; the CSS is in Editor.module.css
      immediatelyRender: false, // scripts/check-csp.ts renders on the server
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { "aria-label": "Page content", "aria-multiline": "true", role: "textbox", class: classes.prose ?? "" } },
      onUpdate: () => {
        autosave.markDirty();
      },
    },
    [],
  );

  useEffect(() => (editor ? autosave.attach(() => editor.getJSON()) : undefined), [editor, autosave]);

  // A link to one of this page's blocks (#<block id>): scroll to it and highlight it briefly.
  useEffect(() => {
    if (editor && hash) flashBlock(editor, decodeURIComponent(hash), FLASH_MS);
  }, [editor, hash]);

  return (
    <div className={classes.editor}>
      {editor && (
        <>
          <DragHandle
            editor={editor}
            computePositionConfig={HANDLE_POSITION}
            onNodeChange={({ pos }) => {
              handleTarget.current = pos;
            }}
          >
            {/* Mouse-only (keyboard users move blocks with cut and paste); hovering outlines the
                block it moves, a click selects that block. */}
            <div
              className={classes.dragHandle}
              aria-hidden
              title="Drag to move this block, click to select it"
              onMouseEnter={() => {
                const pos = handleTarget.current;
                const dom = pos === null ? null : editor.view.nodeDOM(pos);
                if (dom instanceof Element) dom.classList.add(classes.handleTarget ?? "handleTarget");
              }}
              onMouseLeave={() => {
                for (const el of editor.view.dom.querySelectorAll(`.${classes.handleTarget ?? "handleTarget"}`)) el.classList.remove(classes.handleTarget ?? "handleTarget");
              }}
              onClick={() => {
                if (handleTarget.current !== null) editor.chain().focus().setNodeSelection(handleTarget.current).run();
              }}
            >
              <span className={classes.grip}>⠿</span>
            </div>
          </DragHandle>
          <BubbleToolbar editor={editor} ctx={ctx} />
        </>
      )}
      <EditorContent editor={editor} />
      <ArchivePicker store={picker} />
      <LinkDialog store={linkDialog} />
    </div>
  );
}
