# Notes system

Status: implemented (2026-10-13). Design and decisions below; how to extend it: AGENTS.md "Notes".

Update the Notes section to use a block style editor with a page + tag
based navigation and search tool.

Tiptap is what will give the block style (we are just using the free,
open source community edition) and markdown-friendly (as input, doesn't need to store as md) text editor.

https://github.com/ueberdosis/tiptap

There should also be a block that activates an excalidraw embed, which
will be just the project react module.

https://github.com/excalidraw/excalidraw

I want to be able to link easily from the achive and embed different types
from there. Currently, that's just text, text files, and videos. Maybe a small
search and select tool.

It should be easy to improve the system in future, so make sure whatever implementation
choices are made are made clear.

Pages should also be able to link to each other's blocks.

We are aiming for good performance, and a nice interface that doesn't get in the way.

Don't let input do things like re-renders, such as re-rendering excalidraw, or causing
videos to restart.


Performance tips

- Keep the document out of React state. Let the editor own its state, and subscribe only to what you need. In Tiptap, that means turning off re-render-on-every-transaction and using selector hooks for toolbars.

- Use plain DOM node views for common nodes. Render paragraphs, headings, and links natively. Use React node views only for heavy embeds such as diagrams, drawings, and archive items. A React root per paragraph is the usual cause of the “Tiptap is slow” reports.

- Don’t mount many editors at once. If you show lists of notes, backlinks, or transclusions, render them as static HTML and mount an editor only on focus. Logseq-style outliners stay fast this way.

- Treat archive embeds as atom nodes. Store an ID or content hash in an atom: true node and render it non-editable. Because the content is immutable, you can cache rendered output indefinitely and lazy-load it with IntersectionObserver.

- Load diagrams and drawings lazily, as separate islands. Render Mermaid only when the block is visible. For drawings, Excalidraw is MIT and embeds well. Check tldraw’s license before using it, because production use isn’t fully free anymore.

- Debounce persistence. Serialize to JSON or markdown on idle, not on every keystroke.


## Design and decisions

What was built from the spec above, and why. AGENTS.md "Notes" has the file map and recipes.

### Notes and the archive are separate

Notes are editable pages for thoughts; the archive holds immutable content brought into the
system for referencing. Notes own all their data in `notes_*` tables (pages, tags, blocks, links,
drawings) and write nothing into the archive. The one point of contact: a page *references*
archive entries (an embed or an inline link), and every save makes the page's archive refs
(`module = "notes"`, `itemId = <page id>`) match the entries its doc uses, through an
archive-owned function (`setRefs` in `src/server/archive/repo.ts`), in the save's transaction. So
an entry a page shows can't be deleted; removing the embed (or the page) releases it. Notes tags
are their own too: only the validation rule (`src/shared/tags.ts`) and the search parser
(`src/server/search.ts`) are shared code.

### Pages and storage

- Flat pages with tags; no hierarchy. Navigation is the pane (search, tag chips, pages by last
  edit, each with a ⋮ menu holding Delete), links between pages, and each page's backlinks. The
  pane can be folded away (remembered per browser); the page stays centred in the view either way.
- The pane refreshes its list itself when pages change (`web/src/modules/notes/events.ts`), never
  through `router.invalidate()`: TanStack Router handles every re-render like a navigation and
  scrolls the window to the top, which made the page jump after each save.
- A page's content is Tiptap's ProseMirror JSON, stored as is (`notes_pages.doc`, jsonb). The
  server never runs Tiptap: `src/shared/notes-doc.ts` checks the shape and limits (depth 48,
  50 000 nodes, 8 MiB bodies) and `analyzeDoc()` extracts what is indexed. Each save rebuilds, in
  one transaction: the plain text (search), the blocks with ids (`notes_blocks`), the links
  (`notes_links`), the drawings shown (`notes_page_drawings`) and the archive refs.
- Saves are versioned: `PUT` names the version it started from and gets a 409 if another tab saved
  since; the page then offers "Load the saved version" or "Keep mine". No merging.
- Tags are set separately (`PATCH`), unversioned.

### Blocks and links

- Every block type that can be linked (paragraph, heading, quote, code block, embed, drawing) has a
  stable id from Tiptap's UniqueID extension, rendered as `data-id`. List items hold paragraphs,
  which have their own ids.
- Block ids are unique within a page only (a pasted block may keep its id), so links name the page
  and the block: `/notes/p/<page>#<block>`. Opening one scrolls to the block and highlights it.
- `[[` links a page (or creates one), `((` searches blocks of every page and links one. Links store
  a label snapshot; page titles are resolved when the page loads (`Page.linkTitles`), so a renamed
  page shows its new title and a deleted one shows as broken. Links to a deleted page stay.
- Backlinks are static text under the page (no editors mounted): one line per linking page, then
  one short line per block on it that links here, which opens that page at that block. Link labels
  count as their block's text. No transclusion yet.

### Editor and performance

- One Tiptap editor per open page, loaded lazily (its own chunk). It owns the doc: it receives the
  doc once and is never controlled from React state; `shouldRerenderOnTransaction` is off, so typing
  re-renders no React component. The bubble toolbar reads editor state through `useEditorState`
  selectors.
- Text blocks have no node views (plain ProseMirror DOM). Inline links are plain DOM node views.
  Only archive embeds and drawings are React node views, and their heavy part is memoised on the
  id, so selection changes and typing never re-render it, and a playing video keeps playing.
  Moving a block (drag, or cut and paste) does recreate its view: a video restarts when moved.
- Embeds and drawings load when they come near the viewport (IntersectionObserver), then stay
  mounted. Archive entries are fetched once per session; text excerpts are cached by entry and file
  (files are immutable).
- Autosave: a change only marks the page dirty; the doc is serialised 800 ms after the last change,
  on idle, and when the page is left (with `keepalive` when the tab closes, for bodies up to
  64 KiB; beyond that the browser asks before closing with unsaved changes).
- Blocks move with the drag handle (left of each block, highlighting the block it moves; a click
  selects the block). Embeds and drawings are not natively draggable, so pressing and dragging
  inside them (drawing, scrubbing a video) never drags the block.
- Web links: `[text](address)` typed or pasted, bare addresses (autolink), `/` → "Web link", or
  Ctrl/⌘+K (also from the selection toolbar) open a dialog; Ctrl/⌘+click opens a link.
- Code blocks: Ctrl/⌘+Enter leaves one (as do three Enters or ↓ at the end); a hint says so while
  the cursor is inside.
- Menus are mounted on `<body>` with a z-index above the page; a drawing being edited isolates
  Excalidraw's own layers (`isolation: isolate`), so menus never end up behind it.
- Markdown: typed shortcuts come from StarterKit's input rules (`# `, `- `, `1. `, `> `, `**b**`, …);
  pasted plain text that looks like markdown is parsed by `@tiptap/markdown`. Pages are not stored
  as markdown.

### Archive embeds

- `/` → "Archive entry" (embed) or "Link to an archive entry" opens a search-and-select dialog;
  pasting `archive:<id>` or an `/archive/e/<id>` link on its own embeds that entry.
- Each archive type has an embed (`web/src/modules/notes/embeds/index.ts`, typed so a new type
  can't be forgotten): text and text files show the first 4 KiB, videos the archive's own player
  (`archive/types/video/Player.tsx`, shared with the entry page).
- A video embed remembers where it was left and offers "Resume at …" (no automatic seek). The
  position is per browser (localStorage, keyed by page and block id; `embeds/videoPosition.ts`),
  not in the doc, so watching never saves the page or causes version conflicts. Nothing is kept in
  the first 5 s or the last 10 s, and nothing is written before the video has played.
- Video bookmarks (labelled times) are stored on the embed block (`attrs.bookmarks`, read with
  `parseBookmarks()` in `notes-doc.ts`) and saved with the page: they autosave and undo like any
  edit, and the same video embedded elsewhere has its own. Their labels are the block's text, so
  page search and `((` find a video by them. Editing them re-renders the embed in place; the
  `<video>` keeps playing.

### Drawings (Excalidraw)

- A drawing block stores only a drawing id; the scene lives in `notes_drawings` and is saved on its
  own a second after the last change, so drawing never re-saves the page. A drawing no page shows
  is deleted by the hourly sweep a day later (undo can still bring it back). A drawing block pasted
  into another page shows the same drawing (shared, not copied).
- The block shows a static preview (`exportToCanvas`) and mounts the interactive Excalidraw only
  while editing: a page with many drawings stays cheap and doesn't trap scrolling.
- Constraints from the CSP (`script-src 'self'`, no inline styles), found in a spike:
  - Excalidraw's fonts are self-hosted (copied to `static/excalidraw/fonts/` at build), and the
    build rewrites its `esm.sh` fallback URL to our own path: Chromium checks every URL of a
    FontFace against the CSP up front, so the fallback alone logged violations.
  - SVG/PNG export subsets fonts with WebAssembly via `new Function` (needs `'unsafe-eval'`) and
    applies inline styles, so Excalidraw's export, save-to-file and open actions are hidden. Its
    context-menu "copy as PNG/SVG" still exists and works without font subsetting, logging CSP
    errors. Allowing it would be a CSP change.
  - The image tool is off: images would be stored as base64 in the scene and hit the 8 MiB body
    limit. Images in drawings would need a notes-owned file store (a separate decision).
  - Excalidraw's "Mermaid to Excalidraw" dialog is removed: its package pulls in mermaid and
    `langium@3.3.1`, which fails the install's trust policy, so `pnpm-workspace.yaml` overrides it
    away and `vite.config.ts` aliases its lazy import to a stub that reports it unavailable.
- Mantine `Modal` needs `lockScroll={false}` here: its scroll lock injects a `<style>`.

### Not done (yet)

Nested pages, transclusion (live embedded blocks), inline `#tags`, task lists, Mermaid blocks,
merging concurrent edits, images in drawings, page links by paste.

