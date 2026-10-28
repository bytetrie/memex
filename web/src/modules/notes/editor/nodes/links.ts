// Inline links as atom nodes: to a page ([[), to a block of a page ((( ), to an archive entry.
// Plain DOM node views (no React): there can be many of them, and all they render is an <a>.
// A plain click follows the link inside the app; modifier clicks and middle clicks behave like
// any link. Each keeps a `label` snapshot from when it was inserted, shown if the target is gone.

import { Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NOTE_NODES } from "../../../../../../src/shared/notes-doc.ts";
import { entryHref, pageHref, strAttr, type NotesEditorContext } from "../context.ts";
import classes from "../Editor.module.css";

type Shown = { href: string; text: string; broken: boolean };

function linkNode(name: string, attrs: string[], show: (node: PMNode) => Shown, ctx: NotesEditorContext) {
  const dataAttrs = (node: PMNode) =>
    Object.fromEntries(attrs.map((a) => [`data-${a.toLowerCase()}`, strAttr(node, a) ?? ""]));
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return Object.fromEntries(
        attrs.map((a) => [a, { default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${a.toLowerCase()}`), renderHTML: () => ({}) }]),
      );
    },
    parseHTML() {
      return [{ tag: `a[data-type="${name}"]` }];
    },
    renderHTML({ node }) {
      const { href, text } = show(node);
      return ["a", { "data-type": name, href, ...dataAttrs(node) }, text];
    },
    renderText({ node }) {
      return show(node).text;
    },
    addNodeView() {
      return ({ node }) => {
        const a = document.createElement("a");
        a.dataset.type = name;
        a.className = classes.link ?? "";
        const paint = (n: PMNode) => {
          const { href, text, broken } = show(n);
          a.href = href;
          a.textContent = text;
          a.classList.toggle(classes.broken ?? "broken", broken);
          a.title = broken ? "This page no longer exists" : "";
        };
        paint(node);
        a.addEventListener("click", (e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          ctx.open(a.getAttribute("href") ?? "");
        });
        return {
          dom: a,
          update(updated) {
            if (updated.type.name !== name) return false;
            paint(updated);
            return true;
          },
          ignoreMutation: () => true,
        };
      };
    },
  });
}

export const pageLinkNode = (ctx: NotesEditorContext) =>
  linkNode(
    NOTE_NODES.pageLink,
    ["pageId", "label"],
    (node) => {
      const pageId = strAttr(node, "pageId") ?? "";
      const title = ctx.titles.get(pageId);
      return { href: pageHref(pageId), text: title ?? strAttr(node, "label") ?? "Missing page", broken: title === undefined };
    },
    ctx,
  );

export const blockLinkNode = (ctx: NotesEditorContext) =>
  linkNode(
    NOTE_NODES.blockLink,
    ["pageId", "blockId", "label"],
    (node) => {
      const pageId = strAttr(node, "pageId") ?? "";
      const title = ctx.titles.get(pageId);
      const label = strAttr(node, "label") ?? "block";
      return { href: pageHref(pageId, strAttr(node, "blockId")), text: `${title ?? "Missing page"} › ${label}`, broken: title === undefined };
    },
    ctx,
  );

// Archive entries can be renamed; the link shows its label from when it was inserted.
export const archiveLinkNode = (ctx: NotesEditorContext) =>
  linkNode(
    NOTE_NODES.archiveLink,
    ["entryId", "label"],
    (node) => ({ href: entryHref(strAttr(node, "entryId") ?? ""), text: strAttr(node, "label") ?? "Archive entry", broken: false }),
    ctx,
  );
