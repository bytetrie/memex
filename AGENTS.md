# AGENTS.md: how this app is built and how to extend it

Read this before changing code. [README.md](README.md) covers the environment
(container, Caddy, systemd);
Design notes for upcoming features live in [ideas/](ideas/).

## Stack

| Layer | Tool | Where |
|---|---|---|
| Language | TypeScript everywhere, strict | `tsconfig.json` (server, scripts), `web/tsconfig.json` (browser) |
| API | Hono on Node 24, run directly from `.ts` (no server build) | `server.ts`, `src/server/` |
| Validation / shared types | zod | `src/shared/` |
| API description | OpenAPI 3.1 generated from the zod schemas (hono-openapi) | `GET /api/openapi.json`, `src/server/openapi.ts` |
| Database | Postgres through drizzle (`drizzle-orm`, `postgres` driver); migrations are generated SQL | `src/server/db/`, `drizzle/` |
| Logging | pino: JSON lines on stdout, into journald | `server.ts` |
| UI | React 19 + Mantine 9 | `web/src/` |
| Routing | TanStack Router, code-based route tree | `web/src/router.tsx` |
| Bundler | Vite, builds `web/` into `static/` | `vite.config.ts` |
| Icons | Font Awesome glyphs built into a font by Fontello | `web/icons/fontello.json` |
| Text font | TeX Gyre Heros as WOFF2 | `font/texgyre/` → `web/public/fonts/` |
| Package manager | pnpm (lockfile committed) | `package.json` |
| System packages | Debian apt, synced by `scripts/sync-env.sh` | `infra/apt-packages.txt` |
| Unit + integration tests | vitest (integration on the `memex_test` database) | `vitest.config.ts`, `src/**/*.test.ts`, `scripts/**/*.test.ts` |
| Video | yt-dlp (pinned bundled release build) + ffmpeg, in runners; hls.js in the browser | `scripts/runners/`, `infra/yt-dlp.lock`, `web/src/modules/archive/types/video/` |
| Browser tests | Playwright driving Debian's Chromium | `playwright.config.ts`, `e2e/` |

Request flow: browser → Caddy (`https://app.memex`) → files from `static/`,
or `/api/*` → Hono on `127.0.0.1:8080`. Unknown non-file paths serve
`index.html` so client routes like `/notes` survive a reload.

## Layout

```
server.ts                 entry: env, internal-token check, migrations, logger, wiring, serve()
src/shared/api.ts         zod schemas + inferred types used by BOTH sides
src/shared/archive*.ts    the archive's schemas; archive-types.ts holds the type ids + inputs,
                          archive-jobs.ts the job shapes
src/shared/runners.ts     the app <-> runner protocol (requests, events, ports)
src/shared/vtt.ts         WebVTT -> transcript cues (server search text, browser transcript)
src/server/app.ts         Hono routes (createApp); exports AppType; request log, errors, /openapi.json
src/server/validate.ts    validate(target, schema) middleware (also feeds the OpenAPI spec)
src/server/openapi.ts     docs(tag, summary, responses) for every route
src/server/types.ts       Logger + AppEnv (node-free)
src/server/modules.ts     placeholder data for the sidebar components
src/server/db/            drizzle schema.ts (all tables), client.ts, migrate.ts
src/server/archive/       the archive: ports.ts (interfaces), repo.ts (drizzle), routes.ts, gc.ts,
                          http.ts, search.ts, types/ (one handler per archive type + registry);
                          jobs: job-repo.ts, job-routes.ts, jobs.ts (the worker)
src/server/node/          node-only implementations passed in through AppDeps (blob-store.ts,
                          incoming.ts, runner-client.ts); child-process.ts, the only place
                          processes start (scripts and runners use it)
src/server/testing/       test harness: real app + test database + temp blob store + fake runners
drizzle/                  generated SQL migrations (committed; read them before committing)
web/index.html            Vite entry HTML
web/src/main.tsx          MantineProvider + RouterProvider
web/src/zod-config.ts     zod jitless mode (CSP: no eval); imported first
web/src/router.tsx        route tree (every route listed once)
web/src/root.tsx          root route: Shell, not-found and error pages
web/src/nav.ts            sidebar entries (route, label, icon)
web/src/api.ts            typed Hono client + fetch helpers
web/src/theme.ts          Mantine theme (plain data)
web/src/components/       shared components (Shell = sidebar layout)
web/src/modules/<id>/     one folder per sidebar component (route.tsx, ...)
web/src/modules/archive/  list.tsx, entry.tsx, new.tsx, JobList.tsx + types/ (one add form per archive type)
web/src/pages/            routes that are not sidebar components (home)
web/src/icons/            Icon component + GENERATED icons.css, names.ts
web/public/fonts/         GENERATED woff2 files (committed)
scripts/                  sync-env.sh, build-icons.ts, build-fonts.sh, check-csp.ts,
                          archive.ts (CLI), migrate.ts, yt-dlp.ts (pin + install yt-dlp)
scripts/runners/          the runners: ytdlp.ts, encode.ts, lib.ts (see "Runners" below)
vendor/                   the pinned yt-dlp build, gitignored (pnpm yt-dlp install; current -> <version>)
e2e/                      Playwright tests (*.spec.ts), config in playwright.config.ts
infra/                    Caddyfile (project-owned), apt-packages.txt (extra Debian
                          packages), yt-dlp.lock + yt-dlp/public.key (the yt-dlp pin and
                          signing key); generated by devstack: unit copy, compress script,
                          devstack-requires.toml, sbom/ (CycloneDX inventory)
static/                   BUILD OUTPUT, gitignored; never edit
```

## Commands

```sh
./scripts/sync-env.sh     # after cloning or pulling: missing apt packages from
                          #   infra/apt-packages.txt (sudo devstack-sync), then pnpm install
                          #   --frozen-lockfile, then the pinned yt-dlp; `pnpm sync-env` once installed
pnpm typecheck            # tsc for server/scripts and for web/
pnpm check:csp            # render every route, fail on CSP-blocked <style> tags
pnpm test                 # vitest: unit tests + API integration tests (memex_test database)
pnpm test:e2e             # Playwright + Chromium against https://app.memex
                          #   (build first); fails on console/CSP errors
pnpm build                # vite build -> static/, then .br/.gz copies
pnpm dev                  # rebuild static/ on change; reload https://app.memex
pnpm dev:hmr              # Vite dev server with HMR on 127.0.0.1:5173 (forward
                          #   the port in VSCode); proxies /api through Caddy
sudo devstack-sync restart app         # after any change under server.ts / src/
journalctl -u memex-app -f             # API logs (no sudo needed)
pnpm db:generate          # after editing src/server/db/schema.ts: writes SQL into drizzle/
pnpm db:migrate           # apply migrations to DATABASE_URL by hand (the app also does at boot)
pnpm archive <command>    # CLI over the API: search, show, add file|text|video, jobs, job,
                          #   tag, gc (prints JSON)
pnpm yt-dlp install       # fetch the yt-dlp pinned in infra/yt-dlp.lock (sync-env.sh does it)
pnpm yt-dlp update [v]    # pin the latest (or v) yt-dlp after checking its signature; review the lock
pnpm icons                # after editing web/icons/fontello.json (needs network)
pnpm fonts                # after changing font/texgyre/ (woff2_compress, from sync-env)
```

**Done means**: `pnpm typecheck`, `pnpm check:csp` and `pnpm test` pass, `pnpm build` succeeds,
the API service is restarted if server code changed, and `pnpm test:e2e` passes
against `https://app.memex` (it loads every sidebar component in Chromium
through Caddy). `pnpm dev:hmr` does not send Caddy's CSP header, so always
confirm through Caddy before calling UI work finished.

## Rules

### Dependencies
- Server-side packages go in `dependencies`; anything only bundled for the
  browser or used at build time goes in `devDependencies` (`pnpm add -D`).
- Prefer what is already here (Mantine, zod, Hono helpers, TanStack Router
  loaders) before adding a library. A new library is a decision: ask the user.
- System (apt) packages go in `infra/apt-packages.txt`, never
  `apt-get install` by hand (sudo only runs `devstack-sync`). Run
  `./scripts/sync-env.sh` to install them; anyone pulling the change does the
  same.
- Do not run `playwright install`: Playwright uses Debian's `/usr/bin/chromium`.

### Server code (runs in Node without a build)
- Only erasable TypeScript: no `enum`, no `namespace`, no parameter properties
  (`erasableSyntaxOnly`). Use `as const` objects or zod enums.
- Relative imports need the `.ts` extension: `import { x } from "./x.ts"`.
- `src/server/app.ts` and everything it imports must stay free of `node:`
  imports: the web app imports its type. Pass Node-specific behaviour in
  through `AppDeps` from `server.ts`.
- Chain routes on the returned app (`return app.get(...).post(...)`) so their
  types flow into `AppType`; group a module's routes in its own `new Hono<AppEnv>()`
  and mount it with `.route("/archive", ...)`. All routes are under `/api` (Caddy
  forwards only that); responses are `no-store` unless a route sets its own policy.
- Validate every input with `validate("param" | "query" | "json", schema)` from
  `src/server/validate.ts`, then read it with `c.req.valid(...)`.
- Document every route with `docs(tag, summary, { status: json(description, Schema) })`
  from `src/server/openapi.ts` before its validators. `src/server/openapi.test.ts` fails
  for a route missing from `/api/openapi.json`.
- Log with `c.var.log` (a pino child carrying the request id), as
  `log.info({ event: "thing.happened", id }, "message")`; never `console.log`.
- The service is sandboxed (read-only filesystem, loopback network only). Data
  belongs in Postgres (through `src/server/db/`) or, for files, in the blob store
  (`$STATE_DIRECTORY/archive/`), never beside the code.
- Everything `app.ts` imports must also be node-free, so the DB, the blob store and the
  logger are interfaces (`src/server/archive/ports.ts`, `types.ts`) whose implementations
  `server.ts` passes in through `AppDeps`. Tests pass their own (`src/server/testing/`).

### Shared schemas
- Any shape crossing the API is a zod schema in `src/shared/api.ts` (split into
  `src/shared/<area>.ts` as it grows). Export the schema and its `z.infer` type.
- The server builds responses typed with these; the client parses responses
  with them in `web/src/api.ts`.

### Web code
- Fetch through `web/src/api.ts` (`api.<path>.$get(...)`, then `Schema.parse`).
  Never hand-write `fetch("/api/...")`.
- Load page data in the route's `loader`; read it with `Route.useLoaderData()`.
- **Accessible UI**: every control has an accessible name (a visible label or an
  `aria-label`), lists and results are real lists with headings, and forms use labelled
  fields with error text. e2e tests find elements only by `getByRole` / `getByLabel`, so
  an unlabeled control fails a test instead of slipping through. This is what lets
  browser agents use the UI.
- Links with params or search params use `AnchorLink` (`web/src/components/`), not
  `<Anchor component={Link}>`, which loses the router's types. Give route components
  that use typed links an explicit return type (`: ReactElement`), or TypeScript's
  inference loops through the registered router.
- Use Mantine components and theme tokens (`var(--mantine-spacing-md)`,
  `c="dimmed"`, ...) over custom CSS. Mantine docs for agents:
  <https://mantine.dev/llms.txt> indexes one Markdown page per topic (e.g.
  `https://mantine.dev/llms/core-button.md`); everything in one file:
  <https://mantine.dev/llms-full.txt>.
- Custom styles go in a co-located `Component.module.css`, using Mantine's
  PostCSS helpers (`rem()`, `light-dark()`, `@mixin hover`,
  `$mantine-breakpoint-sm`). No global CSS beyond `main.tsx`'s imports.
- Theme changes go in `web/src/theme.ts` (keep it plain data; `vite.config.ts`
  imports it) and need a restart of `pnpm dev` / `pnpm dev:hmr`.

### CSP rules
The CSP (`infra/Caddyfile`) allows scripts and styles only from files on our
own origin: no inline `<script>`, no `<style>` elements, no `style="..."` in
HTML. Consequences:
- Styles set by React's `style={...}` prop are fine (applied through the DOM, not
  as HTML attributes).
- **Do not use** Mantine `AppShell`, `Grid`, `SimpleGrid`, or responsive
  style props (`p={{ base: 4, sm: 8 }}`, responsive `Flex` props): they inject
  runtime `<style>` tags, which the browser blocks, breaking layout silently.
  Use a CSS module with CSS grid/flex and media queries instead (see
  `web/src/components/Shell.module.css`, `ModulePage.module.css`).
- `MantineProvider` keeps `withCssVariables={false}` and
  `withGlobalClasses={false}`; the `mantine-static-css` plugin in
  `vite.config.ts` serves that CSS as a static file instead. Keep both in place.
- No `eval` / `new Function` either (`script-src 'self'`). zod runs in jitless
  mode in the browser for this (`web/src/zod-config.ts`); keep that import first
  in `main.tsx`.
- `pnpm check:csp` catches `<style>` tags on every route; in the browser,
  violations are logged to the console by `main.tsx`, and `pnpm test:e2e` fails
  on them.
- Never add `'unsafe-inline'` to fix a violation. Changing the CSP is a decision
  for the user.

## Recipes

### Add an app component (sidebar entry)
Example: `tasks`.
1. `src/shared/api.ts`: add `"tasks"` to `ModuleIdSchema`; add schemas for its data.
2. `src/server/`: add its routes (e.g. `src/server/tasks.ts` exporting a
   function that adds routes, or chain directly in `app.ts`), and add an entry
   in `modules.ts` while it is a placeholder.
3. `web/src/modules/tasks/route.tsx`: copy `modules/notes/route.tsx`, rename
   the route and path, replace `ModulePage` with the real UI as it grows.
   Component-specific pieces live in the same folder.
4. `web/src/router.tsx`: import the route and add it to `addChildren([...])`.
5. Pick an icon (next recipe), then add `{ to: "/tasks", label: "Tasks", icon: ... }`
   to `web/src/nav.ts`.
6. Restart the API, run the "done means" checks.

Nested pages inside a component (`/tasks/$taskId`) are routes with
`getParentRoute: () => tasksRoute`; give the parent an `<Outlet />`. The
sidebar marks a component active for every path under its `to`.

### Icons
1. Find the glyph in Font Awesome 4.7's Fontello config:
   <https://github.com/fontello/awesome-uni.font/blob/master/config.yml>
   (search the `search:` keywords; copy `css`, `code` and `uid`).
2. Add `{ "uid": ..., "css": ..., "code": <code as decimal>, "src": "fontawesome" }`
   to `web/icons/fontello.json`. Other Fontello sets (entypo, typicons, ...)
   work the same way with their own `src`.
3. `pnpm icons`; commit the regenerated `web/public/fonts/icons.woff2`,
   `web/src/icons/icons.css`, `web/src/icons/names.ts`.
4. Use `<Icon name="..." size={20} />` from `web/src/icons/Icon.tsx`; names are
   type-checked. Give icon-only buttons an `aria-label` and a Mantine `Tooltip`.

Never edit the generated icon files by hand, and do not add another icon
library (e.g. Tabler icons) without asking.

### Fonts
Text and headings use `'TeX Gyre Heros'` (set in
`web/src/theme.ts`, `@font-face` rules in `web/src/fonts.css`). To add a face,
put the OTF in `font/`, extend `scripts/build-fonts.sh` if it lives elsewhere,
run `pnpm fonts`, then add an `@font-face` rule.

### Add an API endpoint
```ts
// src/shared/api.ts
export const NoteInputSchema = z.object({ title: z.string().min(1) });

// src/server/app.ts (chained onto the returned app)
.post("/notes", docs("notes", "Create a note", { 201: json("The note", NoteSchema) }), validate("json", NoteInputSchema), async (c) => {
  const input = c.req.valid("json");
  return c.json(created, 201);
})

// web/src/api.ts
export const createNote = async (input: NoteInput) =>
  NoteSchema.parse(await ok(await api.notes.$post({ json: input })));
```

## Archive

The archive (`/archive` in the app) holds **entries**: one coherent item made of one or
more immutable files. Design and decisions: [ideas/archive.md](ideas/archive.md).

| Concept | Meaning |
|---|---|
| Entry | id (uuidv7), `type`, `title`, `source_url`, `meta`, tags. Addressed as `archive:<id>`; UI at `/archive/e/<id>` |
| File | A named file in an entry, with a role and a mime type the type handler picked. Immutable: never replaced or edited |
| Blob | The bytes, stored once by sha256 under `$STATE_DIRECTORY/archive/blobs/` |
| Type | How an entry is added: a server handler + an add form, registered in one list (`file`, `text`, `video`). Its `mode` is `entry` (added in one request) or `job` (added in the background). `file` takes **text files only** |
| Job | One background addition (`job` types, e.g. `video`): queued, then run one at a time, oldest first, by a worker in the app; the entry is created when it finishes. Status, stage, progress, error and log tail are polled from `GET /api/archive/jobs/:id` |
| Ref | "module X, item Y uses entry Z". An entry with refs cannot be deleted (Postgres enforces it) |
| Tag | The only annotation the archive keeps; for search and grouping |

- **Agents**: the API is the interface. Start from `https://app.memex/api/openapi.json`
  and `GET /api/archive/types` (each type's input JSON Schema and `mode`), or use `pnpm archive`
  (`search`, `show`, `add file|text|video`, `jobs`, `job`, `tag`, `gc`). To add a file you first
  upload the bytes (`PUT /api/archive/blobs`, raw body) and then create the entry naming the
  returned hash. A `job` type is queued with `POST /api/archive/jobs` (`{"type":"video","input":
  {"url":"https://..."}}`, 202) and then polled; `409` means already archived (`entryId`) or
  already queued (`jobId`), `429` a full queue (50 waiting).
- **Videos** (`video`, design in [ideas/videos.md](ideas/videos.md)): the `ytdlp` runner downloads
  (≤ 1080p, H.264 + AAC preferred, English subtitles), the `encode` runner remuxes to HLS (one
  fMP4 file with byte ranges, no re-encoding unless the codec needs it) and makes `poster.jpg`,
  `thumb.jpg` and an animated `preview.avif`. The download itself is not kept. The app checks
  every file (playlist refers only to its media, magic bytes) before importing it from
  `$STATE_DIRECTORY/incoming/`, and removes the job folder whatever happens. Entry cards show
  `thumbnail` files (`EntrySummary.thumbnails`). A restart fails the running job (retry it).
- **Other modules** that show or link an entry call `PUT /api/archive/entries/:id/refs/:module/:itemId`
  while they use it and `DELETE` it when they stop; that is how "safe to delete" is traced.
- **Nothing generic**: every kind of content is its own type with its own handling, and an enrichment
  (a transcript, a summary...) is always a particular thing for a particular type, designed with that
  type. There is no endpoint that attaches arbitrary files or mime types to an entry; don't add one.
- **Content types**: the type handler, never the request, sets each file's mime. Files are served
  from the app's origin, so only an allow-list of types a browser plays or parses but never runs
  (video, audio, JPEG/AVIF/WebP, m3u8, VTT, JSON, plain text) is sent as itself; everything else,
  above all `text/html`, `image/svg+xml`, JavaScript and XML, goes out as `text/plain;
  charset=utf-8`, always with `nosniff` (`servedContentType` in `src/server/archive/http.ts`).
  Don't add a type to that list that a browser could render as a document or execute.
- **Size**: a file may be at most `MAX_FILE_BYTES` (4 GiB, `src/shared/archive-types.ts`), enforced
  by Caddy (`request_body` in `infra/Caddyfile`, keep the two equal), by `PUT /archive/blobs` while
  it streams, and by the browser before uploading. JSON bodies are parsed in memory and capped at
  8 MiB (`app.ts`); big text goes in as a file.
- **Text only**: the archive is for things that can be searched and referenced, so the `file`
  type ("Text file" in the UI) refuses anything that is not UTF-8 text (binary data, images, video,
  empty files) with a 400 and deletes the refused upload at once (`ctx.discardBlob`; a handler that
  rejects an upload should do the same).
- **Search** (`q`) covers the title, the source URL and any text a type hands over as `searchText`
  (`text` and `file` index their text, `video` its title, description and transcript). Extracting text from other content is a type's job:
  return it as `searchText` from `ingest`. `q` also takes **#tags**: `report #work #2026` finds
  entries matching the words that have *all* the tags (case-insensitive, exact; a tag with spaces is
  `#"my tag"`). The `tag` parameter and `pnpm archive search --tag t` (repeatable) add tags the same
  way. Tag chips in the UI search for `#tag`.
- Deleting an entry frees its blobs immediately, unless another entry uses the same bytes or they
  were uploaded again since (a new entry may be about to use them). Abandoned uploads are removed by
  an hourly sweep after 24 hours, or on demand with `pnpm archive gc [--grace-hours n]` (with 0, an
  upload not yet attached to an entry goes too). Backups need `devstack db backup` **and**
  `devstack data backup` together.
- **e2e tests run against the real data** and must leave it as they found it: entries are titled
  `e2e-<random>`, searches use words unique to the run (`searchFor()` in `e2e/archive.spec.ts`), and
  `afterEach` deletes this worker's entries and its searches (`DELETE /api/archive/searches`). Never
  clear the whole search history or use generic words: that is the user's data.
- Tests that touch the DB use `useHarness()` (`src/server/testing/harness.ts`), which refuses
  any database whose name does not end in `_test`.

### Change the database schema
1. Edit `src/server/db/schema.ts`.
2. `pnpm db:generate`, then **read** the SQL it wrote in `drizzle/` (check column names and
   defaults) and commit it with the schema change. Never use `drizzle-kit push`.
3. `pnpm test` applies migrations to `memex_test`; `sudo devstack-sync restart app` applies
   them to the real database at boot.
4. Gotchas: give columns explicit names or rely on `casing: "snake_case"` (set in
   `drizzle.config.ts` and `createDb`, keep both in sync). drizzle-kit cannot alter a generated
   column (`search`): it drops and re-adds it, in an order that ignores what the expression reads,
   and the column's index is dropped silently. When you change one, reorder the SQL by hand
   (new columns first) and recreate the index (see `drizzle/0001_*.sql`).
5. The DB row shape and the API shape may differ: map in `repo.ts`, keep API shapes in `src/shared/`.

### Add an archive type
Example: `webpage`. A type is a server handler and a form; `tsc` lists whatever is missing.
1. `src/shared/archive-types.ts`: add `"webpage"` to `ArchiveTypeIdSchema` and export its input
   schema (`WebpageInputSchema`).
2. `src/server/archive/types/webpage.ts`: `defineType({ label, input, ingest })`. `ingest` gets
   the validated input and a context (`putBlob`, `hasBlob`, `log`) and returns
   `{ title, sourceUrl?, meta?, searchText?, files }`. Handlers never touch `node:` modules, the DB or the
   disk. Anything that needs the internet or parses untrusted files belongs in a runner (see
   "Runners" below), never in the app.
3. `src/server/archive/types/index.ts`: register it.
4. `web/src/modules/archive/types/webpage/AddForm.tsx`: a form that ends with `createEntry(...)`
   and navigates to the entry (copy `text/AddForm.tsx`). Optionally a `View.tsx` for a custom page body.
5. `web/src/modules/archive/types/index.ts`: register label, icon (see "Icons") and form.
6. Tests: the handler's pure parts as unit tests, and one case in `src/server/archive/archive.test.ts`.
   Then the "done means" checks.

### Add a job-backed archive type (needs a runner)
Example: `webpage` fetched from the internet. `video` is the worked example
(`src/server/archive/types/video.ts`, `scripts/runners/`).
1. Steps 1 and 3 above, then `defineJobType({ label, input, sourceUrl, run })` instead of
   `defineType`. `sourceUrl(input)` names what is fetched, so the same thing isn't queued or
   archived twice. `run(input, ctx)` returns the same result as `ingest`, using
   `ctx.runner(name, request, DoneSchema)` (progress and log events reach the job row by
   themselves), `ctx.readHead` / `ctx.importFile` for what the runner left in `incoming/`,
   `ctx.progress(stage, percent, detail)` and `ctx.signal`. Check every runner file (names, magic
   bytes, sizes) before importing it: it is untrusted. The worker removes the runner's job folder
   (`dir` in its `done` event) and any blobs that didn't end up in an entry.
2. The runner: `scripts/runners/<name>.ts` using `serve()` from `lib.ts`, with its request and
   `done` schemas and its port in `src/shared/runners.ts`. Tools start through
   `src/server/node/child-process.ts` (argument arrays, `toolEnv()`), output goes into a job folder
   from `makeJobDir()` / `makeSubdir()` (group-writable through the umask `serve()` sets, so the app can delete it). Test it locally
   with `INCOMING_DIR=<tmp> node scripts/runners/<name>.ts < request.json`.
3. Declaring the runner is a host step (see "Runners" below); ask for it.
4. The form calls `createJob(...)` and shows `JobList` / `useJobs` (see `video/AddForm.tsx`).
5. Tests: fake runners in the harness (`h.runners.handle(name, fn)`, see
   `src/server/archive/jobs.test.ts`), plus the runner script's own test.

## Infrastructure notes
- `infra/Caddyfile` is project-owned (`caddy.manage_caddyfile = false` in
  `infra/devstack-requires.toml`): devstack does not regenerate it, so header/CSP
  changes made in the devstack config must be copied into it by hand. Check the syntax with
  `caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile` (`caddy validate` as `dev`
  stops at the CA key it can't read); `sudo devstack-sync reload caddy` validates as root and applies.
- **Same origin only**: every site block imports `devstack_same_origin`, which answers 403 to any request a
  browser marks as coming from another site (`Sec-Fetch-Site: cross-site|same-site`, or a foreign
  `Origin`), page navigations included. Tools (curl, `pnpm archive`, agents) send neither header. No
  route sends CORS headers. Don't remove the import or add CORS: opening the app to another origin is
  a decision for the user. `pnpm dev:hmr`'s proxy relabels its own page's requests (`vite.config.ts`).
- `infra/memex-app.service` is a copy; the unit runs `node server.ts` from
  this folder. Environment: `INTERNAL_TOKEN` and `DATABASE_URL` (the app exits
  without it; both are root-only), `STATE_DIRECTORY` (set by systemd), optional `LOG_LEVEL`.
  Call the app through Caddy (`https://app.memex`), never on :8080.
- `static/` is build output. A fresh clone (or rebuilt container) needs
  `./scripts/sync-env.sh && pnpm build` before Caddy has anything to serve.
- `git` is not installed in the container; commit from the host.

## Agent notes for memex: the container contract

Read this before writing code here. It records what the container actually enforces, so you don't
have to discover it by hitting it. `README.md` is the human orientation; this file is the contract.

`/srv/proj` is this folder inside the container. The declared container-side configuration is in
`infra/devstack-requires.toml` — read it rather than guessing ports, users or runner names.

### You

You run as `dev`, the same account as the terminal, VSCode and its extensions. It has full
internet access but no general root: `sudo` runs only `devstack-sync`. The host and the LAN are
blocked by an incus ACL on the host, not by anything in here.

- **System packages**: add one name per line to `infra/apt-packages.txt`, then run
  `scripts/sync-env.sh`. `apt-get install` by hand is refused, and a hand-installed package is gone
  on the next rebuild. Any service a package ships is masked. After adding one, the SBOM has to be
  regenerated on the host (`./devstack sbom generate`) and `infra/sbom/` committed — say so rather
  than trying it.
- **Git**: all of `.git` is read-only, because the host runs git on it; commits happen on the host.
  Leave your work in the working tree and say what you changed. With git installed, reading works
  (`git log`, `git diff`, `git status`); anything that writes `.git` (commit, branch, stash, `git add`,
  switching branches) fails. Never create a repository inside the project (`git init`, a clone, a
  submodule): the host's git would run its config. Clone into `/tmp` instead.
- **Secrets**: never in a tracked file, not even in a test or an example. Credentials go in an
  ignored file (`.env`) or the container's secrets folder. Before pushing, the host runs
  `./devstack leaks scan` (gitleaks, with its own config) over the history and every file that isn't
  ignored; `gitleaks:allow` comments, `.gitleaksignore` and `.gitleaks.toml` here have no effect on it.
- **npm dependencies**: never add, remove or upgrade one (`pnpm add`, `pnpm update`, an edit to
  `package.json` or `pnpm-lock.yaml`) without saying so: name the package, the version and why. Each one
  is reviewed by a person, and so is every lockfile change. Don't touch `pnpm-workspace.yaml`'s
  settings or add to `allowBuilds` (which lets a package run its install script) without flagging it
  the same way. pnpm refuses versions less than 7 days old; pick an older one rather than working
  around it. Never `npm install` here.
- **Checks**: before handing work over, run `pnpm typecheck` and `pnpm lint:changed` (or `pnpm check`
  for everything), which is also what CI runs. They are not git hooks. Fix the cause rather
  than the warning:
  - no `any`, and no casts that narrow a type (`JSON.parse(x) as T`): validate external data instead.
    A cast you can justify gets `// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    -- <why it is safe>`; never `{ ... } as T` (annotate the variable).
  - every promise is awaited, returned or explicitly handled; no async callbacks where a void one is
    expected.
  - no `eval`, `new Function` or string timers. Browser code doesn't assign HTML strings
    (`innerHTML`, `insertAdjacentHTML`, `document.write`): build elements or set `textContent`.
  - `child_process` only in `src/server/node/child-process.ts` (the path `eslint.config.js` allows):
    execFile/spawn with an argument array, never `shell: true`. Create it there if you need it.
  - a lookup keyed by user input (a file extension, a name) uses a `Map`, not an object literal:
    `table[ext]` answers `"constructor"` or `"__proto__"` with Object's own properties.
  - `noUncheckedIndexedAccess` is on: `rows[0]` is `T | undefined`. Destructure and check, use
    `.at(-1)`, or `single()` in `repo.ts` for a row a statement always returns; never `!`.
  - numbers in template literals go through `String(n)`; a nullable value gets `?? ""` first.
  - React: `onSubmit={(e) => void submit(e)}` / `onClick={() => void navigate(...)}` for async
    handlers, braces around setter callbacks (`(e) => { setQ(e.currentTarget.value); }`), and
    `SubmitEvent`, not the deprecated `FormEvent`. `throw notFound()` / `redirect()` are allowed.
  - `.catch((err: unknown) => { log.error(...); })`; stubs return `Promise.resolve(x)`, not `async () => x`.
  - tests parse responses with the shared schemas (`EntrySchema.parse(await res.json())`), not
    `const e: Entry = await res.json()` or `as T`. The same goes for anything typed `any` (JSON
    files, `vite.ssrLoadModule`): a zod schema, `z.custom<Fn>(isFunction)` for a function.
  - enum-like DB columns are plain `text`: parse them on the way out (`FileRoleSchema.parse(row.role)`),
    don't cast. Iterate a `Record<ArchiveTypeId, ...>` with `ArchiveTypeIdSchema.options`, not
    `Object.entries(...) as [...]`.
  - fake repos and blob stores come from `src/server/testing/stubs.ts` (`stubRepo({ getEntry })`),
    never a `Proxy` cast to the interface.
  - `fs` calls with a computed path are flagged everywhere except `src/server/node/blob-store.ts`
    (paths built from a validated sha256); elsewhere justify each one on its line.
  - `eslint-disable` only for one rule, on one line, with `-- reason`; never edit `eslint.config.js`
    or `tsconfig.json` to loosen a rule without flagging it.
- **Calling the app**: use `https://app.memex`, not `127.0.0.1:8080`. Without Caddy's
  internal token the app answers every request with a bare 500. Login shells get the dev CA through
  `NODE_EXTRA_CA_CERTS`; set it yourself for a process started another way.

### The app — `memex-app`

Runs as `memex-app` on `127.0.0.1:8080`, egress profile `local`. Its one writable
path is `$STATE_DIRECTORY` (`/var/lib/memex-app`). The project tree is read-only to it, so nothing
may be written beside the code at runtime. `sudo devstack-sync restart app` after an edit;
`journalctl -u memex-app -f` for logs, no sudo needed.

## Caddy — `infra/Caddyfile`

Every site block imports `devstack_same_origin`, defined root-owned in `/etc/caddy/Caddyfile`;
`caddy.same_origin` in `infra/devstack-requires.toml` decides what it does. By default only the
site's own pages may make requests to it: a request the browser marks as coming from another site (a
foreign `Origin`, or `Sec-Fetch-Site: cross-site` or `same-site`) gets a bare 403.

- `curl`, Node `fetch`, test runners and you all pass: they send neither header. A 403 that only the
  browser gets is this rule.
- Never add CORS headers, let another origin in, or remove the import: that is the user's decision.
  Say what needs it and why. Don't define `(devstack_same_origin)` here either: Caddy refuses a
  second definition and stops loading.
- A dev server (Vite, Storybook) is reached through Caddy, not a forwarded port: once the user lists
  it in `caddy.dev_servers` on the host, it is served at `https://<name>.@@DEV_HOST@@/` with `/api/*`
  going to the app, so page and API share one origin. Keep it on `localhost`; don't proxy `/api`
  yourself or rewrite `Origin`. If Vite's hot reload doesn't connect, set `server.hmr.clientPort = 443`.
- `sudo devstack-sync validate caddy` checks the config without applying it; `sudo devstack-sync
  reload caddy` validates, then applies. (`caddy validate` as you fails: it can't read Caddy's CA key.)

### Runners — the full contract

The project's runners are `ytdlp` (port 9101) and `encode` (port 9102), in `scripts/runners/`,
with their protocol in `src/shared/runners.ts`. They have to be declared on the host (see
"Declaring and changing one"); until then `infra/devstack-requires.toml` says `runners = []` and
video jobs fail with "runner ytdlp is not available". The declaration they need:

```toml
runners = [
  { name = "ytdlp",  command = "node scripts/runners/ytdlp.ts",  port = 9101, memory_max = "1G", runtime_max = "2h", max_connections = 1 },
  { name = "encode", command = "node scripts/runners/encode.ts", port = 9102, memory_max = "1G", runtime_max = "1h", max_connections = 1 },
]
```

A runner is **not** a daemon. It is a socket-activated, per-connection job for tools that need the
internet or parse untrusted files, and it is the most tightly sandboxed thing in this stack. The
enforced version of all of this is the unit itself: `systemctl cat memex-<name>@.service`.

**Shape**

- stdin and stdout *are* the TCP connection. Read the request from stdin, write the reply to stdout;
  stderr goes to the journal.
- One process per connection; the connection closing ends the job. No accept loop, no listener, no
  in-memory state between requests.
- `MemoryMax` (default `1G`) and `RuntimeMaxSec` (default `1h`) are hard caps. Exceeding either kills
  the job mid-request.
- The request and response format is the project's to define. Define it explicitly and validate input.

**Environment**

- It is exactly `NODE_ENV=production` and `INCOMING_DIR`. There is no `EnvironmentFile=`, so no
  `DATABASE_URL`, no `INTERNAL_TOKEN`, no secrets of any kind, and none to be read from a file either.
- Use `$INCOMING_DIR`. A runner unit has no `StateDirectory=`, so `$STATE_DIRECTORY` is unset here.

**Filesystem**

- `$INCOMING_DIR` is the only writable path: no logs, caches, lockfiles or build output anywhere else.
  The project tree is `ReadOnlyPaths`, `.git` is `InaccessiblePaths`, and `/tmp` is private per job.
- Write with generated names; never let a request choose the path.
- `RestrictSUIDSGID=yes`: a `chmod` that sets the setgid bit fails with `EPERM`. To leave files the
  app (group `memex-data`) can read and delete, set the umask to 007 and create folders with
  mode 770; `incoming/` is setgid, so the kernel adds the bit and the group (`scripts/runners/lib.ts`).
- A runner is not in `memex-data`, so it cannot read the rest of the app's data — only traverse
  into `incoming/`. Everything it leaves there is untrusted input that the app must validate.

**Network**

- Public internet and DNS only. **No loopback**: a runner cannot reach the app, Caddy, Postgres or
  anything on `127.0.0.1`, so there is no callback channel. The only ways to return data are stdout
  and a file in `$INCOMING_DIR`. No host, no LAN, no private ranges.
- `RestrictAddressFamilies=AF_INET AF_INET6`: no unix sockets, for IPC or anything else.
- An app that may hand a runner any URL reaches the internet through it. That is accepted, not
  prevented — validate URLs on the app side if it matters.

**Kernel and process limits**

- `SystemCallFilter=@system-service` with `SystemCallErrorNumber=EPERM`: a syscall outside that set
  fails with `EPERM` rather than anything clearer.
- `CapabilityBoundingSet=` is empty, so no capabilities and no port below 1024.
- Do not add `MemoryDenyWriteExecute=yes` to a Node unit — V8's JIT needs W+X pages.

**Declaring and changing one**

- `command` must be plain words from `[A-Za-z0-9_./=:@+-]` separated by single spaces,
  project-relative. No shell, quotes, `$`, `%`, pipes or redirection: `node scripts/runner.ts` is
  valid, `sh -c "node scripts/runner.ts 2>&1"` is not. Anything more goes inside the script.
- The port is loopback-only and must not collide with the app, Postgres, 22, 80, 443, 2019 or another
  runner. It is denied in the firewall: runners stay internal.
- Adding a runner, or changing its name, port, command or limits, is a **host** operation: edit
  `devstack.toml`, then `./devstack up --redo isolation`, which asks for a typed `yes` because it runs
  project code as a service with internet access. Ask for it; do not write systemd units yourself.
- Changing a runner's **code** needs no host step: `sudo devstack-sync restart runners`, or just open
  a new connection. Logs: `journalctl -u 'memex-<name>@*' -f`.

**Testing one**

From inside the container, `printf '<request>' | nc 127.0.0.1 <port>`. Check the reply on stdout, that
the expected file appeared under `INCOMING_DIR`, and that nothing else was written. Confirm the
sandbox rather than assuming it: a loopback connection from inside the job must be refused.

### When you are done

Say which of these constraints the work relies on, and flag anything you worked around — especially a
wish for loopback, a secret, a writable project path or a shell. Those mean the work belongs in the
app, not in a runner.
