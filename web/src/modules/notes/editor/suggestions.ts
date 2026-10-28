// The editor's typed menus, all built on @tiptap/suggestion and shown with SuggestionList:
//   /    block commands (headings, lists, an archive entry, a drawing...)
//   [[   link to a page (or create one)
//   ((   link to a block of any page
// A new command is one more entry in slashCommands().

import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { NOTE_NODES } from "../../../../../src/shared/notes-doc.ts";
import { createDrawing, createPage, listPages, searchBlocks } from "../../../api.ts";
import type { NotesEditorContext } from "./context.ts";
import classes from "./Editor.module.css";
import { SuggestionList, type MenuItem, type SuggestionListHandle, type SuggestionListProps } from "./SuggestionList.tsx";
import { editLink } from "./webLinks.ts";

type Choice<T> = { item: MenuItem; value: T };

type MenuOptions<T> = {
  name: string;
  char: string;
  label: string;
  empty: string;
  allowSpaces?: boolean;
  debounce?: number;
  items: (query: string) => Choice<T>[] | Promise<Choice<T>[]>;
  select: (editor: Editor, range: Range, value: T) => void;
};

function menu<T>(opts: MenuOptions<T>) {
  const listProps = (props: SuggestionProps<Choice<T>, Choice<T>>): SuggestionListProps => ({
    label: opts.label,
    empty: opts.empty,
    loading: props.loading,
    items: props.items.map((c) => c.item),
    command: (item) => {
      const choice = props.items.find((c) => c.item.key === item.key);
      if (choice) props.command(choice);
    },
  });

  return Extension.create({
    name: opts.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<Choice<T>, Choice<T>>({
          editor: this.editor,
          pluginKey: new PluginKey(opts.name),
          char: opts.char,
          allowSpaces: opts.allowSpaces ?? false,
          debounce: opts.debounce ?? 0,
          items: ({ query }) => opts.items(query),
          command: ({ editor, range, props }) => {
            opts.select(editor, range, props.value);
          },
          render: () => {
            let list: ReactRenderer<SuggestionListHandle, SuggestionListProps> | null = null;
            let unmount: (() => void) | null = null;
            return {
              onStart: (props) => {
                // The wrapper is what gets positioned, so it carries the z-index (menuLayer).
                list = new ReactRenderer(SuggestionList, { editor: props.editor, props: listProps(props), className: classes.menuLayer ?? "" });
                unmount = props.mount(list.element);
              },
              onUpdate: (props) => {
                list?.updateProps(listProps(props));
              },
              onKeyDown: ({ event }) => (event.key === "Escape" ? false : (list?.ref?.onKeyDown(event) ?? false)),
              onExit: () => {
                unmount?.();
                list?.destroy();
                list = null;
              },
            };
          },
        }),
      ];
    },
  });
}

const matches = (query: string, ...words: string[]) => {
  const q = query.trim().toLowerCase();
  return q === "" || words.some((w) => w.toLowerCase().includes(q));
};

type Command = { label: string; icon: MenuItem["icon"]; keywords: string; run: (editor: Editor, range: Range) => void };

function slashCommands(ctx: NotesEditorContext): Command[] {
  const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  // Commands that wait for something (the picker, the server) first take the "/query" out.
  const later = (editor: Editor, range: Range, work: () => Promise<void>) => {
    block(editor, range).run();
    work().catch((err: unknown) => {
      console.error("notes: command failed", err);
    });
  };
  const insertArchive = (mode: "embed" | "link") => (editor: Editor, range: Range) => {
    later(editor, range, async () => {
      const entry = await ctx.pickArchive(mode);
      if (!entry) {
        editor.commands.focus();
        return;
      }
      const node =
        mode === "embed"
          ? { type: NOTE_NODES.archiveEmbed, attrs: { entryId: entry.id } }
          : { type: NOTE_NODES.archiveLink, attrs: { entryId: entry.id, label: entry.title } };
      editor.chain().focus().insertContent(mode === "embed" ? node : [node, { type: "text", text: " " }]).run();
    });
  };
  return [
    { label: "Heading 1", icon: "header", keywords: "h1 title", run: (e, r) => block(e, r).setNode("heading", { level: 1 }).run() },
    { label: "Heading 2", icon: "header", keywords: "h2 subtitle", run: (e, r) => block(e, r).setNode("heading", { level: 2 }).run() },
    { label: "Heading 3", icon: "header", keywords: "h3", run: (e, r) => block(e, r).setNode("heading", { level: 3 }).run() },
    { label: "Bulleted list", icon: "list-bullet", keywords: "ul unordered", run: (e, r) => block(e, r).toggleBulletList().run() },
    { label: "Numbered list", icon: "list-numbered", keywords: "ol ordered", run: (e, r) => block(e, r).toggleOrderedList().run() },
    { label: "Quote", icon: "quote-left", keywords: "blockquote", run: (e, r) => block(e, r).toggleBlockquote().run() },
    { label: "Code block", icon: "code", keywords: "pre", run: (e, r) => block(e, r).toggleCodeBlock().run() },
    { label: "Divider", icon: "minus", keywords: "hr rule line", run: (e, r) => block(e, r).setHorizontalRule().run() },
    {
      label: "Web link",
      icon: "link-ext",
      keywords: "url address website href",
      run: (e, r) => {
        later(e, r, () => editLink(e, ctx));
      },
    },
    { label: "Link to a page", icon: "link", keywords: "[[ page", run: (e, r) => block(e, r).insertContent("[[").run() },
    { label: "Link to a block", icon: "link", keywords: "(( block reference", run: (e, r) => block(e, r).insertContent("((").run() },
    { label: "Archive entry", icon: "box", keywords: "embed video text file archive", run: insertArchive("embed") },
    { label: "Link to an archive entry", icon: "box", keywords: "archive link", run: insertArchive("link") },
    {
      label: "Drawing",
      icon: "pencil",
      keywords: "excalidraw sketch diagram",
      run: (e, r) => {
        later(e, r, async () => {
          const drawing = await createDrawing();
          e.chain().focus().insertContent({ type: NOTE_NODES.drawing, attrs: { drawingId: drawing.id } }).run();
        });
      },
    },
  ];
}

export function suggestionMenus(ctx: NotesEditorContext) {
  const commands = slashCommands(ctx);

  const insertLink = (editor: Editor, range: Range | null, node: { type: string; attrs: Record<string, string> }) => {
    const chain = editor.chain().focus();
    (range ? chain.insertContentAt(range, [node, { type: "text", text: " " }]) : chain.insertContent([node, { type: "text", text: " " }])).run();
  };

  return [
    menu<Command>({
      name: "slashMenu",
      char: "/",
      label: "Insert a block",
      empty: "No such command",
      items: (query) => commands.filter((c) => matches(query, c.label, c.keywords)).map((c) => ({ item: { key: c.label, label: c.label, icon: c.icon }, value: c })),
      select: (editor, range, command) => {
        command.run(editor, range);
      },
    }),

    menu<{ id: string; title: string } | { create: string }>({
      name: "pageMenu",
      char: "[[",
      label: "Link to a page",
      empty: "Type a page title",
      allowSpaces: true,
      debounce: 150,
      items: async (query) => {
        const q = query.replace(/\]+$/, "").trim();
        const { items } = await listPages({ q: q || undefined, limit: 8 });
        const found = items.map((p) => ({ item: { key: p.id, label: p.title, hint: p.snippet.slice(0, 60) }, value: { id: p.id, title: p.title } }));
        const exact = items.some((p) => p.title.toLowerCase() === q.toLowerCase());
        return q && !exact ? [...found, { item: { key: "create", label: `Create page “${q}”`, icon: "plus" as const }, value: { create: q } }] : found;
      },
      select: (editor, range, value) => {
        if ("id" in value) {
          ctx.titles.set(value.id, value.title);
          insertLink(editor, range, { type: NOTE_NODES.pageLink, attrs: { pageId: value.id, label: value.title } });
          return;
        }
        editor.chain().focus().deleteRange(range).run();
        createPage({ title: value.create }).then(
          (page) => {
            ctx.titles.set(page.id, page.title);
            insertLink(editor, null, { type: NOTE_NODES.pageLink, attrs: { pageId: page.id, label: page.title } });
          },
          (err: unknown) => {
            console.error("notes: creating the page failed", err);
          },
        );
      },
    }),

    menu<{ pageId: string; pageTitle: string; blockId: string; text: string }>({
      name: "blockMenu",
      char: "((",
      label: "Link to a block",
      empty: "Type words from the block",
      allowSpaces: true,
      debounce: 150,
      items: async (query) => {
        const q = query.replace(/\)+$/, "").trim();
        if (!q) return [];
        return (await searchBlocks(q)).map((b) => ({
          item: { key: `${b.pageId}/${b.blockId}`, label: b.text.slice(0, 80), hint: b.pageTitle },
          value: b,
        }));
      },
      select: (editor, range, b) => {
        ctx.titles.set(b.pageId, b.pageTitle);
        insertLink(editor, range, { type: NOTE_NODES.blockLink, attrs: { pageId: b.pageId, blockId: b.blockId, label: b.text.slice(0, 60) } });
      },
    }),
  ];
}
