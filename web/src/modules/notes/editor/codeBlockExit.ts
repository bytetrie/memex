// Getting out of a code block, where Enter and Backspace only edit the code:
// - Mod-Enter leaves it (a new paragraph below); so do Enter three times on an empty last line
//   (here, since Enter also indents) and ArrowDown at the end (Tiptap's own), and Backspace in an
//   empty code block turns it back into text;
// - Enter keeps the line's indent, one step more after an opening bracket or a colon (codeText.ts);
//   Tab and Shift-Tab indent and dedent (Tiptap's, switched on in extensions.ts);
// - while the cursor is in a code block, it shows a hint saying so (a node decoration: the
//   data-hint attribute is drawn by Editor.module.css).

import { Extension, isMacOS } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { enterInCode } from "./codeText.ts";
import classes from "./Editor.module.css";

export const CodeBlockExit = Extension.create({
  name: "codeBlockExit",
  // Before the code block's own Enter (triple Enter), which this one replaces.
  priority: 101,
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.isActive("codeBlock") && this.editor.commands.exitCode(),
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== "codeBlock") return false;
        const action = enterInCode($from.parent.textContent, $from.parentOffset);
        if (!action) return false;
        const start = $from.start();
        if (action.kind === "exit") {
          return this.editor
            .chain()
            .command(({ tr }) => {
              tr.delete(start + action.from, $from.pos);
              return true;
            })
            .exitCode()
            .run();
        }
        return this.editor.commands.command(({ tr }) => {
          tr.insertText(action.insert, start + action.from, $from.pos);
          return true;
        });
      },
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
