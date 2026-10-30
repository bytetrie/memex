# Printable pages

Status: v1 built (see "Design and decisions"; the plan below is what it was built from)

Memex section version 1.

I want to be able to make pages of content that summaries my
notes. I will start by having this focused on making it by hand.
Essentially I just want to be able to build a page of either:
US Letter, Half US Letter, or Quarter US Letter, set a margin
of either 0.25, 0.5, 1 inch, and export it as a single page or
as 2 UP for Half or 4 UP for Quarter.

The page would be text of varying size and weight within text
boxes, drawings I've made using exclaidraw and copied into the
clipboard to paste, SVG I'm pasting / file-dropping, or other
image types for the same. It should be able to have layers so
I can layer stuff on top of other stuff.

I want to be able to give a page a name and tag it. I want to be
able to nav and search pages like I can with notes. While editing
a page, basic undo would be helpful.

Possibly, some what to use a grid builder or just snap-to grid
lines, so I can align elements if I want to.

I want the ability to convert stuff to grayscale and grayscale
halftone. Later I want to have the ability to create color palettes
and do halftone using that, but don't build that yet.

What I also want is to be able to is select a sequence of pages and
export them as a PDF and HTML, so they roughly keep their page
form but are in those formats. With the HTML the content should just
run on as normal but conform to the page structure on print.

What I want to get right in this round is:
- Have pages I can build
- Have a UI that helps me build
- Print / Export the pages
- Handle the few media types I've mentioned

Note that I will likely extend this heavily so prefer generalizing
the API and components for reuse and extension. There are features
like generating charts to put in, get ink layer variations for riso
printing, exporting for e-readers, and similar things I'm planning
to add later. 


## Design and decisions

What was built from the spec above, and why. AGENTS.md "Memex" has the file map and recipes.
Where this differs from the plan below, this section is what holds.

### A separate system, like notes

The memex is the `/memex` sidebar entry. It keeps everything in `memex_*` tables (pages, tags,
assets, which page uses which asset) and its own blob store at `$STATE_DIRECTORY/memex/` (the
same content-addressed store code as the archive, `createBlobStore`). It writes nothing into the
archive or notes. Tags follow the shared rule (`src/shared/tags.ts`) and search the shared parser
(`src/server/search.ts`): words are prefix matches over the title and the text boxes' text, and
`#tag` filters.

### The page doc

One JSON document per page (`memex_pages.doc`, `src/shared/memex-doc.ts`):
`{ format: { size, orientation, margin }, grid: { step, show, snap }, elements: [...] }`.

- Geometry is in points (1/72 in) from the page's top-left corner, and every renderer draws in CSS
  `pt`, so screen, print and the HTML file share one renderer at physical size. The editor zooms
  with a `transform: scale()` set through React's style prop (fine under the CSP).
- `elements` is the z-order (first at the back). The layers panel is that list, top first.
- Every element has `id, kind, x, y, w, h, rotation, opacity, hidden, locked, name?, effects[]`,
  plus its kind's fields. Limits: 500 elements, ids unique, the 8 MiB JSON body cap.
- The server reads a doc only through `analyzePageDoc()`: the text for search and snippets, and the
  assets it uses (rebuilt into `memex_page_assets` on every save, like notes' `analyzeDoc()`).
- Saves are versioned like notes (`baseVersion`, 409 with "Load the saved version / Keep mine"),
  through the same autosave, now generic and shared (`web/src/autosave.ts`,
  `web/src/components/SaveStatus.tsx`).

### Element kinds (v1)

- `text`: ProseMirror JSON from a small Tiptap editor: paragraphs (with an alignment), hard breaks,
  bold, italic, underline and a `size` mark (one of `TEXT_SIZES`), plus the box's base size, line
  height, alignment and colour. The editor is mounted only on the box being edited (double-click,
  Enter, "Add text", "Edit text"); otherwise `RichText.tsx` draws the JSON as React elements.
  The editor can't set style attributes (CSP), so sizes and alignments render as `data-size` /
  `data-align` with one static rule each (`TextBox.module.css`). Leaving a box grows it to fit.
  Typing reaches the doc a moment after it stops, merged into one undo step per box.
  Three faces, each with bold and italic, self-hosted from the TeX Gyre family (GUST Font License,
  the same build as the app's own font, `scripts/build-fonts.sh`): Heros (sans), Termes (serif)
  and Cursor (monospace). A box has a face; a `font` mark sets one for a run of text. Chosen over
  more families to keep one consistent, freely licensed set; more is a later decision.
- `image`: PNG, JPEG, GIF, WebP or AVIF. `svg`: an SVG. Both have a `fit` (contain, cover, fill).
- `excalidraw`: a drawing made in the **scratch pad** ("Draw": a full-screen Excalidraw in a
  dialog) or pasted from a notes drawing (Ctrl+C there copies `{ type: "excalidraw/clipboard",
  elements }`). Stored as a **self-contained SVG** (`asset`) plus the scene JSON (`scene`).
  Double-clicking it, or "Edit drawing", reopens the scratch pad on its scene, and "Update"
  replaces it in place (same position and width).
  Excalidraw's own SVG export is refused by the CSP twice over: it subsets its fonts with
  WebAssembly started through `new Function`, and it sets a `style` attribute on each line of text.
  So the export skips font inlining, the text's style attributes go to a stand-in attribute while
  it runs (restored in the serialised text, which never becomes a DOM in the page), and the
  drawing's fonts are embedded as `data:` URLs per unicode-range subset, choosing the subsets that
  hold the characters used. The list of subsets comes from Excalidraw's own build, read at build
  time by the `excalidraw-fonts` plugin in `vite.config.ts` (which fails the build if a new
  Excalidraw changes its shape). Drawings made before this are PNGs and still show.
- `qr`: a QR code (text or link, error correction L/M/Q/H, colour, quiet zone) drawn as vector
  squares. The encoder is written here (`kinds/qr/encode.ts`, byte mode, versions 1-40) rather
  than added as a dependency; it was checked by decoding codes of every level across versions 1-39
  with jsQR (outside the project).
- `frame`: an empty area for something to go in. "Add image" draws one (drag on the page; a click
  makes a default-sized one), and whatever is then dropped on it, pasted or chosen with it
  selected, drawn ("Draw here…"), made into a QR code or typed ("Text here") takes its place,
  fitted inside it with its proportions, at its place in the layers. So nothing has to be
  rescaled after it lands. Frames show only in the editor; outputs leave them out.

Content that doesn't fill a frame lands at its natural size (96 css px per inch), scaled down to
fit inside the margin, centred on the page or where it was dropped. Paste, drop and the "Add image" picker all go through
one classifier (`paste.ts`).

### Assets and the SVG question

- `PUT /api/memex/assets` takes the raw bytes (cap 64 MiB; SVG and scene JSON 16 MiB). The server
  decides the type from the bytes (magic numbers; SVG and JSON read whole) and refuses anything
  else with a 400, deleting the refused bytes at once. The request's Content-Type is ignored.
- `GET /api/memex/assets/:sha256` is immutable (`max-age=31536000, immutable`, ETag), `nosniff`,
  and carries `Content-Security-Policy: default-src 'none'; sandbox`.
- An asset no page uses has `detached_at` (uploads start detached); the hourly sweep deletes it a
  day later (`src/server/memex/gc.ts`), with stray files and stale temp uploads. Saving a page
  that uses it again (undo) re-attaches it.
- **SVG is served from the app's origin**, which the archive deliberately never does. Kept, with
  three layers: the client strips scripts, `foreignObject`, other embedded documents, `on*`
  handlers, `javascript:` and external references before uploading (`kinds/svg/sanitize.ts`,
  working on the text: a `DOMParser` document inherits the page's CSP and logs a violation for
  every style attribute an SVG holds); the
  server refuses an SVG that still holds any of them (`src/server/memex/sniff.ts`); and the SVG is
  served as an attachment with a sandboxing CSP (`style-src 'unsafe-inline'; img-src data:` only),
  so opening its URL downloads it, and the app shows it only through `<img>`, where nothing runs.
  Caddy adds the site CSP as a second header; browsers enforce both, which is stricter still. The
  alternative, rasterising SVGs on paste, would lose the vector. **This is the user's call to keep
  or change.**

### Effects

A list per element, applied in order, non-destructive; a registry (`EffectSchema` and `EFFECTS`
in `memex-doc.ts`, `effects/index.tsx` for defaults and fields).

- `grayscale`: a CSS `filter: grayscale(1)` on the element; any kind, and it prints.
- `halftone` (image, SVG, drawing): the source is drawn to a canvas at a few samples per cell (our
  own origin, so it isn't tainted), its brightness read, and dots on a screen rotated by `angle`
  drawn as **one SVG path** (`halftone.ts`), so print stays sharp and the DOM stays small. Dot area
  follows the ink (round or square dots, `invert` puts them on the light parts); transparent pixels
  are paper. Results are cached by source, size and params; while resizing, the old dots stretch
  and the new ones follow a moment later. The HTML export waits for running halftones.
- Palette halftones and riso ink layers are later effects in the same registry.

### The editor

- State lives outside React (`doc/store.ts`, `useSyncExternalStore` with selectors): the doc, a
  200-step undo history, the selection, the box being edited, and a drag preview. Commands
  (`doc/commands.ts`) return a new doc that keeps unchanged elements as the same objects, so a drag
  re-renders only the moving elements, and history shares structure. Typing into the same field
  (or nudging) within 1.5 s merges into one step.
- Drags and resizes show as a preview and commit once on release. Snapping (`canvas/snap.ts`):
  the margins, the page edges and centre, other elements' edges and centres, and the grid when it
  snaps, within 6 screen pixels; guides show while snapped. Alt places freely; Shift keeps the
  proportions while resizing.
- Keyboard: Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y), Delete, Ctrl+D, Ctrl+A, arrows (Shift: 10 pt),
  Ctrl+] / Ctrl+[ (Shift: to the top / bottom), Escape (also leaves the frame tool). Dialogs (the
  scratch pad) keep their own keys and pastes. Every element is a focusable button on the canvas,
  and the layers panel reaches all of them: rows select, and one row of controls at its top acts
  on the selection (up, down, to the top or bottom, hide, lock).
- Rotation is a number field; there is no rotation handle yet.

### Outputs

- **Print and PDF**: `/memex/print?pages=<ids>&layout=single|copies`, its own route (no pane). Each
  sheet names its `@page` (`Print.module.css` holds one rule per size and orientation: no
  stylesheet can be made at runtime under the CSP), so Chromium's "Save as PDF" gives every page its
  own size in a mixed sequence. Checked in e2e by the PDF's page boxes. The document itself takes
  the last sheet's page name (`html:has(...)`): left on the default page, closing it after a named
  sheet added a blank Letter page at the end. The sidebar hides in print. Content is clipped to the
  margin: home printers can't print to the edge.
- **Copies**: `impose()` repeats a page on a Letter sheet in whichever orientation holds the most:
  Half Letter 2-up on landscape, Quarter Letter 4-up on portrait (landscape quarters 4-up on
  landscape). A Letter page stays single.
- **HTML**: one file that is an ordinary web page on screen and the designed sheets in print.
  - Screen: the **web view** (`render/FlowRender.tsx`, `flow.ts`): a readable column (about 44em,
    centred, padded) with each page a section. Elements are read in rows (side by side when they
    overlap vertically, top to bottom otherwise); text flows at its own sizes in rem with no fixed
    box, and pictures and QR codes keep their proportions at their share of the page's width,
    wrapping onto their own line on a narrow screen. It approximates the layout; it doesn't copy it.
  - Print: the sheets, exactly as the print view lays them out (`export.css` shows one or the other).
  - "Download HTML" on the print view clones both renderings as shown (it waits until every halftone
    is on screen), inlines every image as a `data:` URL and embeds the faces the pages use. Both
    renderers are inline styles only, so the file needs no other stylesheet. The print view's
    "View" shows either one, so the web page can be checked before downloading.
- Picking a sequence: "Print or export…" in the pane (search, add, order, layout). Its two lists
  have a fixed height and keep room for a scroll bar, so adding or moving pages never shifts the
  buttons under the pointer (with classic scroll bars, a list growing a scroll bar did).

### CSP findings

- A document from `DOMParser` (or `document.implementation`) inherits the page's CSP: parsing an
  SVG with style attributes or `<style>` logs a violation per attribute, as does `setAttribute
  ("style")` on an element that isn't in the page. A `<style>` element made detached and filled with
  `textContent` doesn't. Hence the text-based SVG sanitiser and the export's stand-in attribute.

- zod decides whether it may compile with `new Function` when a schema is *created* unless jitless
  mode is already on. Once the memex's schemas landed in a shared chunk, they were created before
  `web/src/zod-config.ts` ran and the probe hit the CSP. `vite.config.ts` now puts zod and its config
  in one chunk, which runs before any module that makes a schema.
- Tiptap's text box editor runs with `injectCSS: false` like notes' editor; Mantine's `Modal` with
  `lockScroll={false}`.

### Not done (yet)

Charts, palette halftones, riso ink layers, e-reader export, rotation handles, marquee
selection, alignment tools beyond snapping, more font families, images inside drawings (the
scratch pad's image tool is off).

---


# Plan: Memex v1, printable pages

## Context

[ideas/printable.md](ideas/printable.md) asks for the first iteration of the **Memex** system. A memex item is a *page*: a fixed-size printable sheet (US Letter, Half Letter or Quarter Letter, with a 0.25, 0.5 or 1 in margin) made by hand from text boxes, pasted Excalidraw drawings, SVGs and raster images, arranged in layers. Pages have names and tags, and you can search them like notes. Editing has undo and a snap grid. Elements can be turned grayscale or into a grayscale halftone. A page prints on its own or as 2-up (Half) or 4-up (Quarter) copies on a Letter sheet. A chosen sequence of pages exports to PDF (through the browser's print view) and to a standalone HTML file that lays out as pages when printed.

The spec says this will be extended a lot: charts, riso ink layers, palette halftones and e-reader export. So the plan is built on three registries, in the same way as archive types: **element kinds**, **effects** and **outputs**. Each later feature is a new entry in one of them.

Decisions already made with you:
- This *is* the Memex sidebar entry (`/memex`), replacing its placeholder.
- PDF comes from the browser's print view ("Save as PDF"). No PDF library.
- N-up means **copies**: one page repeated 2× or 4× on a Letter sheet.

## Design decisions

- **Separate system, same pattern as notes.** All data lives in `memex_*` tables and a memex-owned blob store at `$STATE_DIRECTORY/memex/`, which reuses `createBlobStore` from `src/server/node/blob-store.ts`. Nothing goes into the archive.
- **Units.** Geometry is stored in points (1/72 in). Rendering uses CSS `pt`, so the screen, print and HTML outputs all come from one React renderer at exact physical sizes. The editor zooms with a `transform: scale()` set through the `style` prop, which the CSP allows.
- **Page doc (jsonb), the source of truth:** `{ format: { size, orientation, margin }, grid: { step, show, snap }, elements: Element[] }`.
  - Array order is the z-order, so the layers panel just shows this order.
  - Every element has `{ id, kind, x, y, w, h, rotation, opacity, hidden, locked, name?, effects: Effect[] }` plus fields for its kind.
  - On every save, `analyzePageDoc()` rebuilds two things: the search text (the text-box text) and the set of assets the page uses. This is the same approach as notes' `analyzeDoc()`.
- **Element kinds (v1):**
  - `text`: rich text with paragraphs and marks for weight, size and alignment. It is a small ProseMirror JSON. A Tiptap editor is mounted only on the box being edited. Otherwise a small JSON→React renderer draws it, with no `innerHTML`.
  - `image`: PNG, JPEG, WebP, GIF or AVIF asset.
  - `svg`: SVG asset.
  - `excalidraw`: the clipboard scene is stored as a JSON asset so it can be edited later. It renders through `exportToSvg({ skipInliningFonts: true })` in the lazy Excalidraw chunk. The SVG node is appended to the DOM, not parsed from a string.
- **Margin.** The editor draws the margin as a guide, and elements snap to it. All outputs clip to the margin box, because home printers can't print full-bleed.
- **Assets.** These are content-addressed blobs.
  - Upload is `PUT /api/memex/assets` with a raw body. The server checks the magic bytes against an allow-list, and the server sets the mime type, not the request.
  - Assets are served immutable and `nosniff`.
  - Each save rebuilds `memex_page_assets` from the doc. An asset no page uses gets `detached_at`. An hourly sweep deletes it a day later, the same as notes drawings, so undo still works within that day.
- **⚠ SVG served from the app origin.** The archive deliberately never does this, so I'm flagging it for you to decide.
  - Mitigations (defence in depth):
    1. The client sanitises the SVG before upload with `DOMParser`. It removes `<script>`, `<foreignObject>`, `on*` attributes and external `href`s.
    2. The server sends the SVG with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` and `Content-Disposition: attachment`. If you open its URL directly, it downloads instead of rendering.
    3. The page shows it only through `<img>`, where scripts never run.
  - The alternative is to rasterise SVGs on paste, which loses the vector.
- **Effects.** Effects are non-destructive and listed per element. Each one is a registry entry: `{ id, label, params schema, appliesTo kinds, render }`.
  - `grayscale`: a CSS `filter: grayscale(1)`, which works for every kind and in print.
  - `halftone`: rasterises the source to a canvas. Same-origin assets don't taint the canvas. It measures the brightness of each cell and renders an `<svg>` of dots, so print stays sharp.
    - Parameters: cell size, angle, dot shape, invert.
    - Applies to image, SVG and Excalidraw elements, not text.
    - Results are cached by asset and parameters. If the dot count gets heavy, the work can move into a Web Worker (`worker-src 'self'` allows it).
  - Palette halftone and ink layers come later as new effects.
- **Outputs.** Each output is a registry entry. The v1 entries are `print` (single or N-up) and `html`, and e-reader export comes later.
  - **Print view.** A `/memex/print?pages=…&layout=single|copies` route renders the sheets.
    - `@page` rules can't be injected at runtime because of the CSP. Instead, a static CSS module defines a named `@page` for every sheet size and orientation (a finite set). Each sheet uses `page: <name>`.
    - Chromium's "Save as PDF" then produces pages at exact sizes.
    - The Shell hides its sidebar under `@media print`.
    - Imposition is a pure function: `impose(format, layout)` returns the sheet size and the cell positions. Half on Letter landscape gives 2 cells, Quarter on Letter portrait gives 4.
  - **HTML export.** This runs on the client so that effects (halftones) come out exactly as on screen.
    - It reads the print view's DOM (reading `outerHTML` is fine; only assigning HTML strings is linted).
    - It inlines assets as `data:` URIs and adds a static stylesheet imported with `?raw`.
    - In that stylesheet, the screen layout is a continuous column of page boxes and the print layout uses `@page`.
    - It downloads through `Blob` + `<a download>`.
- **Editor state and undo.**
  - A small external store (`useSyncExternalStore` with selectors) holds the doc, so dragging one element re-renders only that element.
  - Each command produces a new doc that shares unchanged parts with the old one. The history stack holds up to 200 docs.
  - Drags and resizes show a live preview but commit once, on pointer-up.
  - Text typing uses Tiptap's own history while the box is being edited, and commits as one step when you leave the box.
  - Autosave follows notes' versioned save: 800 ms debounce, `baseVersion`, 409 → "Load saved / Keep mine". Reuse the logic of `web/src/modules/notes/autosave.ts`.
- **No new npm dependencies.** Everything uses React, Mantine, Tiptap, Excalidraw and zod, which are already here. The editing canvas is built with plain DOM and pointer events, not Konva or fabric. Font weights are limited to what TeX Gyre Heros ships (regular and bold, plus italic).

## Implementation steps

### 0. Spike (prove the risky parts first)
1. `exportToSvg({ skipInliningFonts: true })` renders a pasted scene under the CSP, and Excalidraw's self-hosted fonts apply. If not, fall back to a 300 dpi PNG from `exportToCanvas`, as notes' preview does.
2. Static named `@page` rules give correct PDF page sizes in Chromium for a mixed sequence, for example a Letter page followed by a Half page.
3. An SVG asset served with the headers above still renders in `<img>` and can be drawn to a canvas.

### 1. Shared schemas: `src/shared/memex.ts`, `src/shared/memex-doc.ts`
- Page size, orientation and margin enums, plus a point-size table (Letter 612×792, Half 396×612, Quarter 306×396).
- The element discriminated union, built from a per-kind schema list, and the effect union built from a per-effect param list.
- The API shapes: `Page`, `PageSummary`, `PageList`, `PageListQuery`, `CreatePage`, `SavePage`, `PatchPage`, `Saved`, `VersionConflict` and `TagCount`. Mirror `src/shared/notes.ts` and reuse its shapes where they are identical.
- Limits: 500 elements and an 8 MiB body.
- `analyzePageDoc(doc) → { text, assetShas }`.
- Tags reuse `src/shared/tags.ts`.
- In `src/shared/api.ts`, remove `"memex"` from `PlaceholderModuleIdSchema`.

### 2. Database: `src/server/db/schema.ts` → `pnpm db:generate`, then read the SQL
- `memex_pages`: id uuidv7, title, doc jsonb, text, version, created/updated timestamps, and a generated `search` tsvector built the same way as `notes_pages`, with its GIN index and the updated index.
- `memex_tags (page_id, tag)`.
- `memex_assets (sha256 pk, mime, size, created_at, detached_at)`.
- `memex_page_assets (page_id, sha256)`.

### 3. Server: `src/server/memex/`
- `ports.ts`: the `MemexRepo` interface and `MemexError`, following `src/server/notes/ports.ts`.
- `repo.ts`: drizzle code.
  - Each save runs in one transaction: version check, text, and a rebuild of `memex_page_assets`. It also detaches or re-attaches assets.
  - Search uses `src/server/search.ts` (words and `#tags`).
- `routes.ts`, mounted at `/memex` in `src/server/app.ts`, with `docs()` and `validate()` on every route:
  - pages: list/search, create, get, save (409), set tags, delete
  - `GET /tags`
  - `PUT /assets` (raw body, capped by `MAX_FILE_BYTES`, magic-byte check, unknown types refused with 400 and the blob discarded)
  - `GET /assets/:sha256` (the cache and security headers above)
- `gc.ts`: removes detached assets and their blobs, and old upload temp files. It runs from `server.ts`'s hourly sweep, next to `sweepNotes`.
- `server.ts`: `createBlobStore(join(stateDir, "memex"))` and `createMemexRepo(db)`, passed in through `AppDeps`.
- `src/server/modules.ts`: drop the memex placeholder.
- `scripts/check-csp.ts` and `src/server/testing/` (harness and stubs): add a memex stub repo and stub store.

### 4. Web: `web/src/modules/memex/`
- `route.tsx` and `layout.tsx`, with a pane for search, tag chips, pages by last edit, New and a ⋮ Delete menu.
  - Extract the generic parts of the notes pane (`web/src/modules/notes/layout.tsx` `Pane`, `usePaneOpen`) into `web/src/components/ItemPane.tsx`, but only if notes' behaviour and e2e stay unchanged. Otherwise copy it.
- `page.tsx`: the editor screen. It is a CSS-module grid of toolbar, canvas and right column (inspector over layers). No `Grid`/`SimpleGrid`/responsive props.
- `doc/`: `store.ts` (external store, commands, history), `commands.ts` (add, move, resize, reorder, delete, duplicate, set props, set format) and `autosave.ts`.
- `canvas/`:
  - `PageCanvas.tsx`: the page and margin guide, the grid, and one memoised `ElementView` per element.
  - `SelectionLayer.tsx`: select, shift multi-select, drag, 8 resize handles (shift keeps aspect), arrow keys move 1 pt (shift: 10 pt).
  - `snap.ts`: pure snapping to the grid, the margins, the page centre and other elements' edges.
- `kinds/`: one folder per kind (`text/`, `image/`, `svg/`, `excalidraw/`), each with `Render.tsx`, `Inspector.tsx` and `fromPaste`. `kinds/index.ts` is a `Record<ElementKind, …>`, so tsc flags a missing kind.
- `paste.ts`: one pure classifier for clipboard and drop data:
  - image file → `image`
  - SVG file or text starting with `<svg` → sanitise → `svg`
  - text JSON with `type: "excalidraw/clipboard"` → `excalidraw`
  - other text → `text`

  It uploads through `web/src/api.ts` and places the element at its natural size, scaled to fit inside the margin. An "Add image" file picker does the same.
- `effects/`: `grayscale.ts`, `halftone.ts` (the pure `halftoneDots(luminance, params)` and its renderer) and `index.ts` (the registry). The inspector shows the effects that apply to the selected element's kind.
- `LayersPanel.tsx`: a real list, top layer first. Each row is named after its element, with reorder (up/down and Ctrl+] / Ctrl+[), hide, lock and select buttons, each with an `aria-label`.
- Keyboard: Ctrl+Z / Ctrl+Shift+Z, Delete, Ctrl+D, Escape.
- `output/`:
  - `impose.ts` (pure)
  - `PrintView.tsx` and the route `/memex/print`, with a "Print / Save as PDF" button that calls `window.print()`
  - `Print.module.css` (static named `@page` rules)
  - `exportHtml.ts`
  - `ExportDialog.tsx`: pick pages through search, order them, choose single or copies (copies only for Half and Quarter), then Print or Download HTML.
- `web/src/router.tsx`: add the print route under memex. `web/src/components/Shell.module.css`: hide the sidebar under `@media print`.
- Add the API calls to `web/src/api.ts`. Pick icons for the tools, adding Font Awesome glyphs through `web/icons/fontello.json` and `pnpm icons` if needed.

### 5. Docs
- Add a "Design and decisions" section to `ideas/printable.md`, the same way `ideas/notes.md` has one.
- Add a "Memex" section to `AGENTS.md`: the file map, plus recipes for **adding an element kind**, **adding an effect** and **adding an output**. Update the layout table and the placeholder note.

## Verification

- **Unit tests (vitest):**
  - `memex-doc` schema limits and `analyzePageDoc`
  - `impose` (sheet sizes and cell positions for each format)
  - `snap`
  - `halftoneDots`
  - the paste classifier
  - the SVG sanitiser
- **Integration test:** `src/server/memex/memex.test.ts` uses `useHarness()`. It covers:
  - page CRUD, search with `#tags`, the 409 on a stale save
  - asset upload: allowed types, refused types and their blob discarded, SVG response headers
  - asset detach and re-attach across saves, and the GC
  - `openapi.test.ts` coverage
- **e2e:** `e2e/memex.spec.ts` with pages titled `e2e-<random>` and deleted in `afterEach`. It uses only `getByRole`/`getByLabel`. Steps:
  - create a page, set Half Letter and a 0.5 in margin
  - add and edit a text box (bold, larger size)
  - add an image through the file input
  - reorder layers and check the order
  - undo and redo
  - apply halftone and check the dots render
  - open the print view with copies and check there are 2 cells per sheet
  - download the HTML and check it contains every page and no external URLs

  No CSP console errors may appear.
- **By hand through Caddy (`https://app.memex`):**
  - paste from Excalidraw (Ctrl+C in a notes drawing) and paste an SVG
  - Save as PDF from the print view and check the PDF's page sizes
  - open the exported HTML file both on screen and in print preview
- **"Done means":** `pnpm typecheck`, `pnpm lint:changed`, `pnpm check:csp`, `pnpm test`, `pnpm build`, `sudo devstack-sync restart app`, `pnpm test:e2e`.

## Out of scope for v1 (registries leave room)
Charts, palette halftone, riso ink layers, e-reader export, editing pasted Excalidraw drawings in place, rotation handles (rotation is only a number field in v1), smart alignment beyond snapping, and extra font families.
