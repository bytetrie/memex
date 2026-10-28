// Formatting for selected text, shown only while text is selected (no fixed toolbar). Reads the
// editor through useEditorState selectors, so it re-renders when the marks under the selection
// change, not on every keystroke.

import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { isMacOS, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "../../../icons/Icon.tsx";
import type { NotesEditorContext } from "./context.ts";
import classes from "./Editor.module.css";
import { editLink } from "./webLinks.ts";

function Mark({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <Tooltip label={label}>
      <ActionIcon variant={active ? "filled" : "subtle"} aria-label={label} aria-pressed={active} onClick={onClick} size="md">
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

export function BubbleToolbar({ editor, ctx }: { editor: Editor; ctx: NotesEditorContext }): ReactElement {
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      className={classes.bubble}
      shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive("codeBlock") && e.state.selection instanceof TextSelection}
    >
      <Group gap={2} role="toolbar" aria-label="Format text">
        <Mark label="Bold" active={marks.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <b>B</b>
        </Mark>
        <Mark label="Italic" active={marks.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </Mark>
        <Mark label="Strikethrough" active={marks.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <s>S</s>
        </Mark>
        <Mark label="Code" active={marks.code} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Icon name="code" />
        </Mark>
        <Mark label={`${marks.link ? "Edit link" : "Link"} (${isMacOS() ? "⌘K" : "Ctrl+K"})`} active={marks.link} onClick={() => void editLink(editor, ctx)}>
          <Icon name="link" />
        </Mark>
      </Group>
    </BubbleMenu>
  );
}
