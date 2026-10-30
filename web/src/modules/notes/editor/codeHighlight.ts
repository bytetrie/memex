// Syntax colours in code blocks: inline decorations from the language-agnostic tokenizer
// (codeText.ts), so the doc stays plain text and no node view is involved. A change re-tokenizes
// only the code blocks it touched; the other decorations are mapped through it.

import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { tokenize, type TokenKind } from "./codeText.ts";
import classes from "./Editor.module.css";

const tokenClass = new Map<TokenKind, string>([
  ["comment", classes.tokComment ?? ""],
  ["string", classes.tokString ?? ""],
  ["number", classes.tokNumber ?? ""],
  ["keyword", classes.tokKeyword ?? ""],
  ["literal", classes.tokLiteral ?? ""],
  ["function", classes.tokFunction ?? ""],
]);

const isCode = (node: PmNode) => node.type.name === "codeBlock";

function blockDecorations(node: PmNode, pos: number): Decoration[] {
  const start = pos + 1;
  return tokenize(node.textContent).map((t) => Decoration.inline(start + t.from, start + t.to, { class: tokenClass.get(t.kind) ?? "" }));
}

function build(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (isCode(node)) decorations.push(...blockDecorations(node, pos));
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

// The ranges of the new doc that the transaction's steps replaced.
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  return ranges;
}

function update(tr: Transaction, old: DecorationSet): DecorationSet {
  let set = old.map(tr.mapping, tr.doc);
  const seen = new Set<number>();
  const size = tr.doc.content.size;
  for (const [from, to] of changedRanges(tr)) {
    tr.doc.nodesBetween(Math.max(0, Math.min(from, size)), Math.max(0, Math.min(to, size)), (node, pos) => {
      if (!node.isTextblock) return true;
      if (seen.has(pos)) return false;
      seen.add(pos);
      // Whatever was there (a block that stopped being code keeps no colours), then its new tokens.
      set = set.remove(set.find(pos, pos + node.nodeSize));
      if (isCode(node)) set = set.add(tr.doc, blockDecorations(node, pos));
      return false;
    });
  }
  return set;
}

const key = new PluginKey<DecorationSet>("codeHighlight");

export const CodeHighlight = Extension.create({
  name: "codeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? update(tr, old) : old),
        },
        props: {
          decorations: (state) => key.getState(state) ?? null,
        },
      }),
    ];
  },
});
