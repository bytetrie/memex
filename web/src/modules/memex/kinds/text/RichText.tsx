// A text box's content (ProseMirror JSON from its Tiptap editor, TextBoxEditor.tsx) drawn as
// React elements: no HTML strings, no editor. Paragraphs, hard breaks, and bold, italic,
// underline, size and font marks (TEXT_NODES / TEXT_MARKS in src/shared/memex-doc.ts); anything else
// shows its text. Must match the editor's look: it is what the box shows when not being edited.

import type { ReactNode } from "react";
import { FONT_FAMILIES, FontFamilySchema, TEXT_MARKS, TEXT_NODES, TextAlignSchema } from "../../../../../../src/shared/memex-doc.ts";
import type { DocMark, DocNode } from "../../../../../../src/shared/notes-doc.ts";
import { pt } from "../../render/units.ts";

// `size` writes a size mark's points as a CSS length (pt on a page, rem in the web view).
type Size = (pt: number) => string;

function withMark(mark: DocMark, child: ReactNode, key: number, size: Size): ReactNode {
  switch (mark.type) {
    case TEXT_MARKS.bold:
      return <strong key={key}>{child}</strong>;
    case TEXT_MARKS.italic:
      return <em key={key}>{child}</em>;
    case TEXT_MARKS.underline:
      return <u key={key}>{child}</u>;
    case TEXT_MARKS.size: {
      const points = mark.attrs?.pt;
      return typeof points === "number" ? (
        <span key={key} style={{ fontSize: size(points) }}>
          {child}
        </span>
      ) : (
        child
      );
    }
    case TEXT_MARKS.font: {
      const family = FontFamilySchema.safeParse(mark.attrs?.family);
      return family.success ? (
        <span key={key} style={{ fontFamily: FONT_FAMILIES[family.data].css }}>
          {child}
        </span>
      ) : (
        child
      );
    }
    default:
      return child;
  }
}

function inline(node: DocNode, key: number, size: Size): ReactNode {
  if (node.type === TEXT_NODES.hardBreak) return <br key={key} />;
  if (node.type === TEXT_NODES.text) return (node.marks ?? []).reduceRight<ReactNode>((child, mark, i) => withMark(mark, child, i, size), node.text ?? "");
  return (node.content ?? []).map((n, i) => inline(n, i, size));
}

export function RichText({ doc, size = pt }: { doc: DocNode; size?: Size }): ReactNode {
  return (doc.content ?? []).map((block, i) => {
    const align = TextAlignSchema.safeParse(block.attrs?.align);
    const children = (block.content ?? []).map((n, j) => <span key={j}>{inline(n, j, size)}</span>);
    return (
      <p key={i} style={{ margin: 0, textAlign: align.success ? align.data : undefined }}>
        {children.length ? children : <br />}
      </p>
    );
  });
}
