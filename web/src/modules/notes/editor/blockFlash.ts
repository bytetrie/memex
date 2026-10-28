// Highlights a block for a moment (the target of a block link, #<block id>). A node decoration,
// so ProseMirror keeps it while it redraws the block; it changes nothing in the doc (no save).

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { strAttr } from "./context.ts";
import classes from "./Editor.module.css";

const key = new PluginKey<DecorationSet>("blockFlash");

export const BlockFlash = Extension.create({
  name: "blockFlash",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta: unknown = tr.getMeta(key);
            if (meta === null) return DecorationSet.empty;
            if (typeof meta === "number") {
              const node = tr.doc.nodeAt(meta);
              return node ? DecorationSet.create(tr.doc, [Decoration.node(meta, meta + node.nodeSize, { class: classes.flash ?? "" })]) : DecorationSet.empty;
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

// Scrolls to the block with this id and highlights it for `ms`; false if there is no such block.
export function flashBlock(editor: Editor, blockId: string, ms: number): boolean {
  const hit = { pos: -1 }; // an object: TypeScript doesn't follow assignments made in the callback
  editor.state.doc.descendants((node, at) => {
    if (hit.pos >= 0) return false;
    if (strAttr(node, "id") === blockId) hit.pos = at;
    return true;
  });
  const { pos } = hit;
  if (pos < 0) return false;
  editor.view.dispatch(editor.state.tr.setMeta(key, pos));
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof Element) dom.scrollIntoView({ block: "center" });
  setTimeout(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, null));
  }, ms);
  return true;
}
