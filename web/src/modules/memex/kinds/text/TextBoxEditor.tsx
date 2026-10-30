// Editing one text box in place: a small Tiptap editor (paragraphs; bold, italic, underline; a
// face and a size per run of text; an alignment per paragraph), loaded lazily and mounted only on the box
// being edited. Its toolbar goes into the editor screen's toolbar slot (a portal).
//
// The box's content goes back to the doc a moment after typing stops and when editing ends,
// merged into one undo step per editing session; Tiptap's own history handles undo while typing.
// Leaving the box also grows it to fit its text.

import { ActionIcon, Button, Group, Select, Tooltip } from "@mantine/core";
import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { FONT_FAMILIES, FontFamilySchema, TEXT_MARKS, TEXT_SIZES, TextAlignSchema, type TextAlign, type TextElement } from "../../../../../../src/shared/memex-doc.ts";
import type { DocNode } from "../../../../../../src/shared/notes-doc.ts";
import { Icon } from "../../../../icons/Icon.tsx";
import type { IconName } from "../../../../icons/names.ts";
import { pt } from "../../render/units.ts";
import classes from "./TextBox.module.css";

const SAVE_DELAY_MS = 600;
const PT_PER_PX = 0.75;

// Text size of a run: rendered as data-size (TextBox.module.css), since the CSP lets the editor
// set no style attributes. The static renderer (RichText.tsx) uses the number directly.
const SizeMark = Mark.create({
  name: TEXT_MARKS.size,
  addAttributes() {
    return {
      pt: {
        default: null,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-size")) || null,
        renderHTML: (a: Record<string, unknown>) => ({ "data-size": a.pt }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-size]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

// Type face of a run (data-font, TextBox.module.css), like SizeMark.
const FontMark = Mark.create({
  name: TEXT_MARKS.font,
  addAttributes() {
    return {
      family: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-font"),
        renderHTML: (a: Record<string, unknown>) => ({ "data-font": a.family }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-font]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

const ParagraphAlign = Extension.create({
  name: "paragraphAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          align: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-align"),
            renderHTML: (a: Record<string, unknown>) => (typeof a.align === "string" ? { "data-align": a.align } : {}),
          },
        },
      },
    ];
  },
});

const extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    link: false,
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
  }),
  SizeMark,
  FontMark,
  ParagraphAlign,
];

const ALIGNS: { value: TextAlign; label: string; icon: IconName }[] = [
  { value: "left", label: "Align left", icon: "align-left" },
  { value: "center", label: "Centre", icon: "align-center" },
  { value: "right", label: "Align right", icon: "align-right" },
];

export type TextBoxEditorProps = {
  el: TextElement;
  toolbar: HTMLElement | null;
  // The content while typing (merged into one undo step) and when editing ends, with the height
  // the text needs (in points).
  onChange: (content: DocNode, height: number) => void;
  onExit: () => void;
};

export default function TextBoxEditor({ el, toolbar, onChange, onExit }: TextBoxEditorProps): ReactElement {
  const initial = useRef(JSON.stringify(el.content));
  const last = useRef(initial.current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exit = useRef(onExit);
  exit.current = onExit;

  const editor = useEditor(
    {
      extensions,
      content: el.content,
      injectCSS: false, // the CSP blocks <style>; the CSS is in TextBox.module.css
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      autofocus: "end",
      editorProps: {
        attributes: { "aria-label": "Text box content", "aria-multiline": "true", role: "textbox", class: classes.prose ?? "" },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Escape") return false;
          exit.current();
          return true;
        },
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    const push = () => {
      const json = JSON.stringify(editor.getJSON());
      if (json === last.current) return;
      last.current = json;
      onChange(editor.getJSON(), editor.view.dom.scrollHeight * PT_PER_PX);
    };
    const onUpdate = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(push, SAVE_DELAY_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      clearTimeout(timer.current);
      if (!editor.isDestroyed) push();
    };
  }, [editor, onChange]);

  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const size: unknown = e.getAttributes(TEXT_MARKS.size).pt;
      const font = FontFamilySchema.safeParse(e.getAttributes(TEXT_MARKS.font).family);
      const align = TextAlignSchema.safeParse(e.getAttributes("paragraph").align);
      return {
        bold: e.isActive(TEXT_MARKS.bold),
        italic: e.isActive(TEXT_MARKS.italic),
        underline: e.isActive(TEXT_MARKS.underline),
        size: typeof size === "number" ? String(size) : null,
        font: font.success ? font.data : null,
        align: align.success ? align.data : null,
      };
    },
  });

  const bar = editor && marks && (
    <Group gap={4} wrap="nowrap" role="toolbar" aria-label="Text formatting">
      {(
        [
          { mark: TEXT_MARKS.bold, label: "Bold", icon: "bold", active: marks.bold },
          { mark: TEXT_MARKS.italic, label: "Italic", icon: "italic", active: marks.italic },
          { mark: TEXT_MARKS.underline, label: "Underline", icon: "underline", active: marks.underline },
        ] as const
      ).map((b) => (
        <Tooltip key={b.mark} label={b.label}>
          <ActionIcon variant={b.active ? "filled" : "default"} aria-label={b.label} aria-pressed={b.active} onMouseDown={(e) => { e.preventDefault(); }} onClick={() => editor.chain().focus().toggleMark(b.mark).run()}>
            <Icon name={b.icon} />
          </ActionIcon>
        </Tooltip>
      ))}
      <Select
        aria-label="Font"
        placeholder={FONT_FAMILIES[el.font].label}
        data={FontFamilySchema.options.map((f) => ({ value: f, label: FONT_FAMILIES[f].label }))}
        value={marks.font}
        onChange={(v) => {
          const family = FontFamilySchema.safeParse(v);
          const chain = editor.chain().focus();
          (family.success ? chain.setMark(TEXT_MARKS.font, { family: family.data }) : chain.unsetMark(TEXT_MARKS.font)).run();
        }}
        clearable
        w={130}
        size="xs"
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        aria-label="Text size"
        placeholder={`${String(el.fontSize)} pt`}
        data={TEXT_SIZES.map((s) => ({ value: String(s), label: `${String(s)} pt` }))}
        value={marks.size}
        onChange={(v) => {
          const chain = editor.chain().focus();
          (v ? chain.setMark(TEXT_MARKS.size, { pt: Number(v) }) : chain.unsetMark(TEXT_MARKS.size)).run();
        }}
        clearable
        w={110}
        size="xs"
        comboboxProps={{ withinPortal: true }}
      />
      {ALIGNS.map((a) => (
        <Tooltip key={a.value} label={a.label}>
          <ActionIcon
            variant={(marks.align ?? el.align) === a.value ? "filled" : "default"}
            aria-label={a.label}
            aria-pressed={(marks.align ?? el.align) === a.value}
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={() => editor.chain().focus().updateAttributes("paragraph", { align: a.value }).run()}
          >
            <Icon name={a.icon} />
          </ActionIcon>
        </Tooltip>
      ))}
      <Button size="xs" variant="light" onClick={onExit}>
        Done
      </Button>
    </Group>
  );

  return (
    <div
      className={classes.box}
      style={{ fontFamily: FONT_FAMILIES[el.font].css, fontSize: pt(el.fontSize), lineHeight: el.lineHeight, color: el.color, textAlign: el.align }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <EditorContent editor={editor} className={classes.content} />
      {toolbar && bar ? createPortal(bar, toolbar) : null}
    </div>
  );
}
