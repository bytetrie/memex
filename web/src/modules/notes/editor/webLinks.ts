// Links to web pages (StarterKit's `link` mark), beyond what Tiptap does by itself:
// - typing or pasting [text](address) makes a link (google.com becomes https://google.com);
// - Mod-K opens the link dialog (LinkDialog.tsx): it links the selection, or inserts a new link;
// - Ctrl/Cmd-click opens a link in a new tab (a plain click only places the cursor while editing).
// Typed or pasted bare addresses are linked by StarterKit's autolink.

import { Extension, InputRule, PasteRule, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NotesEditorContext } from "./context.ts";

const MARKDOWN_LINK = /\[([^[\]]+)\]\(([^()\s]+)\)$/;
const MARKDOWN_LINK_GLOBAL = /\[([^[\]]+)\]\(([^()\s]+)\)/g;
const DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/;

// What a person typed as an address, as a link target; null if it isn't one we link.
export function normalizeHref(input: string): string | null {
  const t = input.trim();
  if (/^(https?:\/\/|mailto:)\S+$/i.test(t)) return t;
  if (t.startsWith("/") && !t.startsWith("//")) return t; // inside the app
  if (DOMAIN.test(t)) return `https://${t}`;
  return null;
}

// Opens the link dialog for the current selection and applies what comes back.
export async function editLink(editor: Editor, ctx: NotesEditorContext): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  const current: unknown = editor.getAttributes("link").href;
  const result = await ctx.askLink({
    href: typeof current === "string" ? current : "",
    text: empty ? "" : editor.state.doc.textBetween(from, to, " "),
    hasSelection: !empty,
  });
  if (!result) {
    editor.commands.focus();
    return;
  }
  const chain = editor.chain().focus();
  if (result.href === null) {
    chain.extendMarkRange("link").unsetLink().run();
  } else if (empty) {
    chain
      .insertContent([
        { type: "text", text: result.text || result.href, marks: [{ type: "link", attrs: { href: result.href } }] },
        { type: "text", text: " " },
      ])
      .run();
  } else {
    chain.extendMarkRange("link").setLink({ href: result.href }).run();
  }
}

export const webLinks = (ctx: NotesEditorContext) =>
  Extension.create({
    name: "webLinks",
    addKeyboardShortcuts() {
      return {
        "Mod-k": () => {
          void editLink(this.editor, ctx);
          return true;
        },
      };
    },
    addInputRules() {
      return [
        new InputRule({
          find: MARKDOWN_LINK,
          handler: ({ state, range, match }) => {
            const [, text, address] = match;
            const href = normalizeHref(address ?? "");
            const link = state.schema.marks.link;
            if (!text || !href || !link) return null;
            state.tr.replaceWith(range.from, range.to, state.schema.text(text, [link.create({ href })])).removeStoredMark(link);
          },
        }),
      ];
    },
    addPasteRules() {
      return [
        new PasteRule({
          find: MARKDOWN_LINK_GLOBAL,
          handler: ({ state, range, match }) => {
            const [, text, address] = match;
            const href = normalizeHref(address ?? "");
            const link = state.schema.marks.link;
            if (!text || !href || !link) return null;
            state.tr.replaceWith(range.from, range.to, state.schema.text(text, [link.create({ href })]));
          },
        }),
      ];
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("webLinksOpen"),
          props: {
            handleClick: (_view, _pos, event) => {
              if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof Element)) return false;
              const a = event.target.closest("a[href]");
              const href = a?.getAttribute("href");
              if (!href || a?.hasAttribute("data-type")) return false; // page/block/archive links handle themselves
              window.open(href, "_blank", "noopener,noreferrer");
              return true;
            },
          },
        }),
      ];
    },
  });
