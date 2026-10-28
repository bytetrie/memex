// Getting out of a code block, where Enter and Backspace only edit the code:
// - Mod-Enter leaves it (a new paragraph below); so do Enter three times on an empty last line and
//   ArrowDown at the end (Tiptap's own), and Backspace in an empty code block turns it back into text;
// - while the cursor is in a code block, it shows a hint saying so (a node decoration: the
//   data-hint attribute is drawn by Editor.module.css).

import { Extension, isMacOS } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import classes from "./Editor.module.css";

export const CodeBlockExit = Extension.create({
  name: "codeBlockExit",
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.isActive("codeBlock") && this.editor.commands.exitCode(),
    };
  },
  addProseMirrorPlugins() {
    const hint = `${isMacOS() ? "⌘" : "Ctrl"}+Enter to leave the code block`;
    return [
      new Plugin({
        key: new PluginKey("codeBlockExit"),
        props: {
          decorations: (state) => {
            const { $from } = state.selection;
            if ($from.parent.type.name !== "codeBlock" || !state.selection.empty) return null;
            const pos = $from.before();
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $from.parent.nodeSize, { class: classes.codeActive ?? "", "data-hint": hint })]);
          },
        },
      }),
    ];
  },
});
