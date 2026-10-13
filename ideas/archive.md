# Archive view

Status: v1 implemented (2026-10-05): build steps 1-6 below are done, with the
deviations listed under "As built". AGENTS.md "Archive" is now the working guide;
this file keeps the design and its reasons. The first runner-backed type (videos, with jobs) is
built: see ideas/videos.md.

## Brief

The first part of the system is to have an archive. We will need
to support all kinds of file types. The files will likely be
resolved from various sources and added into the archive. Each
entry in the archive is 1 or more files that form a single coherent
piece of information. We will likely add tools over time to make
certain entries have more info. For example, media often carries
metadata, videos have transcripts / subtitles, webpages have URLs.

We want to leverage the existing postgres install, the existing web
GUI and server, as well as a coherent file store setup to enable
this archive. It should be clear for a dev or agent as to how to
extend and change the system to support new modules or parts of
modules.

Annotating the entries and adding notes is separate and not part of
this system, for the most part we would expect the data to be
mostly immuteable and easy to address such that it can be referenced
and displayed/linked in other parts of the app. This means we also
need to be able to trace where entries are used so we can safely
delete them if we want to do so. The only kind of annotating I'd
probably think of is maybe a tagging system in order to make search
and grouping easier.

The web app currently has an "archive" tab. When the user clicks
this they should be able to access the archive. We want to be
able to see a basic generic view of like, recent additions, recent
searches, and the ability to easily find stuff by type / search.
New additions should be a matter of selecting a type (which will
be extended over time) and this would switch to the appropriate
UI to add the item (which might invoke some tool on the server
to produce the content).

The system should also be easy to operate from an agent, whether
in the UI or via an API in order to find and add entries. Also
add vitest: https://vitest.dev/ in order to add tests where
necessary so future changes don't break anything.

Make a plan for the design and try not to spend too much effort
on novel or complex approaches. The key idea is comfort with dev,
comfort with agent, and minimal, safe, testable code to achieve
as much of what I've described. Once we have a plan, I will review,
and then we can build it out. Ask any questions where unclear.

---

## Plan

Guiding rule: boring parts only. Postgres (through drizzle) holds all
metadata; immutable files sit in a content-addressed directory in the app's
state directory; every type is a small server handler plus a small form, registered in
one list. The HTTP API, described by an OpenAPI spec, is the only interface:
the web UI, a CLI script and agents all use it.

### Decisions so far (review rounds 1–2)

| Topic | Decision |
|---|---|
| DB access | **drizzle** (`drizzle-orm` + `drizzle-kit`) on the **`postgres`** driver. The schema is TypeScript; migrations are generated SQL that gets reviewed and committed. This makes frequent schema changes routine. |
| Logging | **pino**: structured JSON to stdout → journald. |
| API description | **OpenAPI**, generated from the existing zod schemas. |
| UI for agents | Accessible UI, enforced by role-based e2e locators. No MCP / WebMCP for now. |
| Client state | No zustand, no TanStack Query: URL search params + route loaders are enough. |
| Logger wrappers | No loglayer. |
| File store | The app's systemd `StateDirectory` (`$STATE_DIRECTORY` = `/var/lib/memex-app`), backed by a persistent devstack mount. |
| Outbound requests | Out of scope for v1 (the v1 types need no network access). Runner-backed types are the next step after v1 (decided 2026-10-05). Later types fetch through **runners** (see "Later: fetching types through runners"); the app's egress profile stays `local`. |
| Upload limits, delete rights | None for now (single-user tool). Limits and management come with roles later. |

### What exists today (relevant facts)

Rechecked 2026-10-05 in the container (`infra/memex-app.service`,
`infra/devstack-requires.toml`, `psql`):

- Postgres 18.6 is running and `memex` is empty. The app role
  `memex_app` can `CREATE` schemas but has no `CREATEDB`. `uuidv7()` is
  available. `DATABASE_URL` points at `127.0.0.1:5432` over TCP, which matters
  because the unit allows only `AF_INET`/`AF_INET6` (no unix socket).
- The test database exists: `memex_test`, owned by the app role, empty, not
  backed up. Its URL is `TEST_DATABASE_URL` in `~/.config/devstack/memex.env`
  (the dev user's file; the service never sees it).
- There is no DB driver yet: `/api/health` uses a TCP probe.
- The service runs as the fixed user `memex-app`, group `memex-data`,
  with `ProtectSystem=strict` and `ReadOnlyPaths=/srv/proj`. Its one writable
  path is `StateDirectory=memex-app` (`$STATE_DIRECTORY` =
  `/var/lib/memex-app`, an incus volume that survives rebuilds;
  `app.data = "volume"`). `UMask=0027` and mode `2751` mean new files are 0640
  and folders 2750, owned by the app and readable by the `memex-data`
  group, which includes the dev user.
- `$STATE_DIRECTORY/incoming/` already exists and belongs to runners
  (`memex-runner:memex-data`, mode 2770). No runners are declared yet
  (`runners = []`).
- Egress profile `local`: the app reaches loopback only (Caddy, Postgres, and
  future runner ports), with no DNS.
- `src/server/app.ts` must not import `node:` modules (web imports its type).
  So the DB, the file store, the logger (and later the runner client) are
  handed in through `AppDeps` from `server.ts`, and tests pass in their own.
  Today `AppDeps` is `{ tokenOk, dbReachable }`.

### Concepts

| Concept | Meaning |
|---|---|
| **Entry** | One coherent item: id (uuidv7), `type`, `title`, optional `source_url`, `meta` (jsonb), tags, created time. Addressed as `archive:<id>`; UI at `/archive/e/<id>`. |
| **File** | A named file inside an entry (`original.pdf`, `transcript.vtt`, `hls/index.m3u8`) with a `role` (`original`, `derived`, `metadata`, `thumbnail`) and a mime type. It points at a blob. An entry has 1..n files. |
| **Blob** | Immutable bytes, stored by sha256. Identical content is stored once, even across entries. |
| **Type** | Defines how an entry is added (input schema + server handler + add form) and optionally a custom view. Types are registered in one list. |
| **Ref** | A row saying "module X, item Y uses entry Z". An entry that has refs can't be deleted. |
| **Tag** | A free-text label on an entry, used for search and grouping. Tags are the only annotation the archive keeps. |

**Immutability**: after an entry is created, its files are never added to,
replaced or edited (see "No generic enrichment" below). Title and
tags can be edited, and `meta` keys can be added. Deleting removes the whole
entry, and only when it has no refs.

### Database (drizzle)

```
src/server/db/schema.ts        drizzle table definitions (all modules; split per area as it grows)
src/server/db/client.ts        postgres() + drizzle(); imported only by server.ts and tests
src/server/archive/repo.ts     the archive's queries, behind a node-free ArchiveRepo interface
drizzle/                       generated SQL migrations + snapshots (committed)
drizzle.config.ts              drizzle-kit config
```

- Workflow: edit `schema.ts` → `pnpm db:generate` (drizzle-kit writes a SQL
  migration) → read the SQL → commit both files. `server.ts` applies pending
  migrations at boot with drizzle's migrator, before it starts listening.
  `pnpm db:migrate` does the same by hand, using `DATABASE_URL` from
  `~/.config/devstack/memex.env` (`node --env-file-if-exists=...`), as the
  same role the app uses. `drizzle-kit push` is never used
  against a real DB, because it skips the reviewable SQL step.
- `repo.ts` uses drizzle's query builder. Raw `sql\`\`` is only for things
  drizzle doesn't model (full-text search ranking).
- API shapes stay hand-written in `src/shared/archive.ts`. The DB row shape
  and the API contract are allowed to differ; the repo maps one to the other.

Tables (as drizzle definitions; shown here as their SQL for review):

```sql
archive_blobs    (sha256 text pk, size bigint, created_at)
archive_entries  (id uuid pk default uuidv7(), type text, title text, source_url text null,
                  meta jsonb default '{}', created_at,
                  search tsvector generated always as
                    (to_tsvector('simple', title || ' ' || coalesce(source_url, ''))) stored)
                  -- gin index on search; index on (type, created_at desc)
archive_files    (entry_id → entries on delete cascade, name text, role text, mime text,
                  sha256 → blobs, created_at, pk (entry_id, name))
archive_tags     (entry_id → entries on delete cascade, tag text, pk (entry_id, tag))
archive_refs     (entry_id → entries ON DELETE RESTRICT, module text, item_id text,
                  created_at, pk (entry_id, module, item_id))
archive_searches (id identity pk, query text, type text null, created_at)
```

- `search` is a drizzle `customType` (tsvector) with `generatedAlwaysAs`.
- The `on delete restrict` on refs means Postgres itself blocks deleting a
  referenced entry, so a bug in the app can't break a reference.
- Search uses built-in full-text search plus type/tag filters. Searching
  transcripts later means extending the `search` expression, which is a
  generated migration.

### Logging (pino)

- `server.ts` creates the pino logger, which writes JSON lines to stdout and
  from there to journald. It is passed to `createApp` as `AppDeps.log`, typed
  by a small node-free `Logger` interface.
- A request middleware logs one line per request: request id, method, path,
  status, duration. Each handler gets a child logger with the request id, so
  everything logged while handling a request carries it. 5xx errors are logged
  with the stack.
- Archive events (`entry.created`, `entry.deleted`, `blob.gc`) are logged
  with ids, so `journalctl -u memex-app -o cat | jq 'select(.event)'`
  answers "what happened".
- Tests use a silent logger. The level comes from `LOG_LEVEL` (default `info`).

### File store

- Location: `$STATE_DIRECTORY/archive/` (systemd sets the variable;
  `/var/lib/memex-app` on the persistent volume). `incoming/` next to it
  belongs to runners; the archive never stores anything there. Inside `archive/`: `archive/blobs/ab/cd/abcd…` (sha256 with two levels of fan-out)
  and `archive/tmp/` for uploads in progress. A file is written to `tmp/`,
  hashed while it streams, then renamed into place. That makes writes atomic
  and an upload of an existing hash a no-op.
- Write access: in place now (see "What exists today"). The dev user can
  read the files through the `memex-data` group but not write them, so
  every change, including GC, goes through the app. No project-side unit
  drop-in is needed.
- `server.ts` still fails at startup with a clear message if
  `STATE_DIRECTORY` is unset (e.g. `app.data = "none"` on another machine).
  Tests use a temp directory.
- Code: `src/server/node/blob-store.ts` implements a node-free `BlobStore`
  interface (`put(stream) → {sha256,size}`, `get(sha256, range?) → stream`,
  `delete(sha256)`), and `server.ts` passes it into `AppDeps`. `put` always
  copies the bytes it is given. It never renames an outside file into place,
  so blobs end up owned by the app with its modes even when they came from a
  runner's `incoming/` file.
- Garbage: a blob with no `archive_files` row that is more than 24 h old (an
  abandoned upload, or one whose entry was deleted), and anything in
  `archive/tmp/` older than 24 h, is removed by an hourly in-process sweep or
  on demand through `POST /archive/gc` (which `pnpm archive gc` calls; the
  dev user can't delete files in the store itself).
- Backups: `devstack db backup` + `devstack data backup` (both exist now, run
  on the host). Only both together form a consistent backup; README.md says
  so.

### API (`/api/archive/...`, all zod-validated, schemas in `src/shared/archive.ts`)

| Method + path | Purpose |
|---|---|
| `GET  /archive/types` | Registered types: id, label, icon, input JSON schema |
| `PUT  /archive/blobs` | Raw request body = one file's bytes, streamed. Returns `{sha256, size}`. Works with `curl --data-binary @f` |
| `POST /archive/entries` | `{type, title?, tags?, input}` → the type's handler validates `input`, produces files/meta → `201 Entry` |
| `GET  /archive/entries?q=&type=&tag=&limit=&cursor=` | Search/list, newest first. Leaving out `q` gives "recent additions" |
| `GET  /archive/entries/:id` | Entry with files, tags, refs |
| `PATCH /archive/entries/:id` | Title and tags only |
| `DELETE /archive/entries/:id` | `409 {refs}` if the entry is referenced, else deletes it |
| `GET  /archive/entries/:id/files/*name` | Streams the file (allow-listed mime, else `text/plain`), `Range` support, `ETag` = sha256 |
| `PUT/DELETE /archive/entries/:id/refs/:module/:itemId` | Other modules register or release usage |
| `GET/POST /archive/searches` | Recent searches (the UI records a search when it is submitted, not on every keystroke) |
| `POST /archive/gc` | Runs the garbage sweep now; returns what it removed |
| `GET  /openapi.json` | OpenAPI 3.1 spec of the whole API (not just the archive) |

To add a file entry you upload the bytes first, then create the entry that
names them. This keeps entry creation as plain JSON (easy for agents, easy to
validate) and keeps large files out of memory.

**OpenAPI**: the spec is built from the same zod schemas the routes validate
with, so it can't drift from the code. The library is `hono-openapi` or
`@hono/zod-openapi`, whichever keeps the `validate()` + chained-routes style.
That gets decided in build step 1. A vitest test
fails if a route under `/api` is missing from the spec. AGENTS.md tells agents
to start from `https://app.memex/api/openapi.json`.

### Types (the extension point)

```
src/shared/archive-types.ts            ArchiveTypeIdSchema = z.enum(["file", "text"]) + per-type input schemas
src/server/archive/types/file.ts       { id, ingest(input, ctx) → { title, files, meta } }
src/server/archive/types/text.ts
src/server/archive/types/index.ts      registry: Record<ArchiveTypeId, TypeHandler>
web/src/modules/archive/types/file/AddForm.tsx   (+ optional View.tsx)
web/src/modules/archive/types/text/AddForm.tsx
web/src/modules/archive/types/index.ts           registry: label, icon, AddForm, View?
```

Because the registries are typed `Record<ArchiveTypeId, …>`, `tsc` fails
until every layer has the new type, and that error is the to-do list. v1 ships
two types, neither of which needs network access:

- **file**: one or more uploaded **text files** (decided 2026-10-06: the archive is for
  things that can be searched and referenced, so opaque binary data is refused; see "As
  built"). Title defaults to the first file name.
- **text**: pasted text or Markdown, which the server saves as `content.md`.
  This shows a type whose files are generated on the server from form input.

A generic `View` covers every type that doesn't have its own. It shows the
file list with download links and a plain-text preview of each file.

The `ingest` interface is async and returns plain data, so a later type can
run its work in a runner (and later as a background job) without changing
this layer. `ctx` gives a handler the blob store and the logger. Once runners
exist, it also gets a runner client. Handlers never touch `node:` modules
directly.

### Web UI (`web/src/modules/archive/`)

| Route | Content |
|---|---|
| `/archive` | Search box + type filter chips (search params validated with zod, so results are linkable). With no query: recent additions + recent searches. With a query: results. "Add" menu listing the registered types |
| `/archive/new/$type` | That type's `AddForm`; on success navigates to the entry |
| `/archive/e/$entryId` | Title/tags (editable), the type's `View` or the generic one, meta, "used by" (refs), Delete (disabled with a reason while refs exist) |

- Data loads in route loaders through `web/src/api.ts` as usual. Layout uses
  CSS modules (no `Grid`/`SimpleGrid`, per the CSP rules). The placeholder
  entry for `archive` in `src/server/modules.ts` goes away.
- **Accessible UI, for people and browser agents**: every control has an
  accessible name (visible label or `aria-label`), lists and results use real
  list/heading structure, and forms use `<label>`s with error text tied to
  the field. The rule goes into AGENTS.md "Web code". The e2e tests find
  elements only by `getByRole` / `getByLabel`, so an unlabeled control fails
  a test instead of slipping through.

### Agent and CLI access

- The API is the agent interface: `https://app.memex/api/...` (Caddy adds
  the internal token), described by `/api/openapi.json`.
- `scripts/archive.ts` (`pnpm archive …`) is a thin CLI over the typed Hono
  client: `search <q> [--type]`, `show <id>`, `add file <paths…> [--tag]`,
  `add text <file|->`, `tag`, `gc`. It prints JSON so agents can parse it.
- AGENTS.md gets an "Archive" section: concepts, where the spec is, CLI usage,
  the DB workflow (`schema.ts` → `db:generate` → review → commit), and a
  recipe "Add an archive type" (the 6 files above + a test).

### Tests (vitest)

- Add `vitest` (devDependency), `vitest.config.ts`, and `pnpm test`.
  "Done means" grows to include `pnpm test`.
- **Unit tests** for pure code: path/name validation, Range header parsing,
  search query building, type input schemas, OpenAPI coverage of all routes.
- **Integration tests** for the API through `app.request()`, using the
  test database `memex_test` (`TEST_DATABASE_URL`, loaded by
  `vitest.config.ts` from `~/.config/devstack/memex.env`; setup refuses to
  run unless the database name ends in `_test`) and a temp directory as the
  store. Migrations are applied once per run and tables are truncated between
  tests, so tests never touch real data. Covered: upload → create → get →
  search → stream with Range →
  ref blocks delete → release → delete → gc.
- **e2e** (Playwright, role-based locators only): add a text entry in the UI,
  find it by search, open it. e2e runs against the real dev app and database,
  so the test tags its entry `e2e` with a unique title and deletes it through
  the API afterwards.
- No React component tests in v1. They would need jsdom + Testing Library
  (more deps); e2e covers the UI.

### Build order (each step leaves everything green)

1. vitest, pino, drizzle + `postgres`, the OpenAPI library; migrations at
   boot; `/api/health` using a real query; `/api/openapi.json`.
2. BlobStore + tests (temp dir), wired to `$STATE_DIRECTORY/archive/` in
   the service (no longer waits for a devstack change).
3. Archive schema + repo + API + integration tests.
4. `file` and `text` types + CLI.
5. Web UI + e2e.
6. AGENTS.md / README updates: the archive section and recipe, `pnpm test` in
   "Done means", and the new runtime/dev npm packages each recorded with a
   reason in README "Dependencies" (and dropped from "Deliberately not used: DB
   drivers / ORMs"). `ideas/videos.wip.md` updated to build on this, and on
   the runner section below.

Host steps after any dependency change (can't be done in the container):
`./devstack sbom generate`, then commit `infra/sbom/`.

### Deliberately not in v1

Outbound fetching and media processing,
background jobs, metadata extraction, thumbnails, editing or replacing files,
versioning, auth/roles/limits, a separate search engine, MCP/WebMCP. The
schema and type interface leave room for each without rework.

### Later: fetching types through runners (not v1, but v1 must not block it)

Types like videos (`yt-dlp` + `ffmpeg`, see `ideas/videos.wip.md`) or web
pages need the internet and parse untrusted files. The app can't do that
(egress `local`), and the AGENTS.md contract puts that work in a **runner**.
The plan fits that contract as follows:

- **The app drives, the runner works.** A runner can't reach the app, Caddy
  or Postgres, so the app opens a TCP connection to the runner's loopback
  port, writes a JSON request (zod schema in `src/shared/`), and reads a JSON
  reply from the runner's stdout. The reply lists the files it left in
  `$INCOMING_DIR`, which have generated names.
- **Import, then clean up.** The app checks every name in the reply (it must
  be a plain file directly inside `incoming/`, with no `..` or symlink), streams each
  file through `BlobStore.put` (a copy, hashed), treats sizes, mime types and
  meta as untrusted input, and then deletes the incoming files. It can,
  because `incoming/` is group-writable for `memex-data`. The GC sweep also
  removes stale `incoming/` files older than 24 h.
- **Runners can't read the archive.** To process a file that is already
  archived (e.g. transcode an uploaded video), the app streams its bytes to
  the runner over the connection. The runner never gets a path into
  `archive/`.
- **Long jobs.** A runner job may run up to `runtime_max` (default 1 h) with
  `memory_max` (default 1 G), and at most `max_connections` (default 4) run at
  once. A download or HLS transcode is too slow for one HTTP request, so the
  first runner-backed type also brings a small `archive_jobs` table
  (queued/running/done/failed, plus the log tail) and an in-process worker in
  the app. The UI and agents poll the job, and the entry is created when it
  finishes. Jobs that were running when the app restarts are marked failed.
- **Code layout.** Runner entry points are `scripts/runners/<name>.ts`, run as
  `node scripts/runners/<name>.ts` (plain command words only). They import only
  `src/shared/` schemas, never `src/server/` or the DB. The app-side client
  lives in `src/server/node/runner-client.ts` and is passed in through
  `AppDeps`.
- **Who does what.** Declaring a runner (name, port, command, limits) is a
  host step (`devstack.toml`, then `./devstack up --redo isolation`, with a
  typed `yes`). Tools such as `ffmpeg` go in `infra/apt-packages.txt` (then
  `./devstack sbom generate` on the host). After that, changing runner code
  needs only `sudo devstack-sync restart runners`.
- **URL policy.** Anything that can hand a runner a URL can use it to reach
  the internet. Fetching types therefore validate URLs on the app side
  (`https:` only, and per type an allow-list of hosts where it makes sense).
- **Viewing.** The CSP already allows `media-src blob:` and `worker-src blob:`,
  which is what hls.js needs, so HLS playback needs no CSP change.

Nothing here changes the v1 schema or API. `archive_jobs` is an additive
migration.

## As built (v1, 2026-10-05)

Differences from the plan above, and things it left open:

- **OpenAPI library**: `hono-openapi`. Its `validator()` replaced `@hono/zod-validator`
  inside `validate()`, so routes keep the `validate()` + chained-routes style. Every route
  also calls `docs(tag, summary, responses)` (`src/server/openapi.ts`); a vitest test fails
  for a route missing from the spec. `GET /api/archive/types` gives each type's input as JSON Schema,
  because `POST /archive/entries` validates `input` per type at runtime (the spec shows it as
  free-form).
- **`archive_blobs`** has an extra `uploaded_at` (last upload of those bytes). The 24 h grace
  period counts from it, so re-uploading an old orphan can't race the sweep.
- **The `file` type takes text only** (decided 2026-10-06). The server reads each uploaded blob
  and refuses it unless it is valid UTF-8 with no binary control characters and some non-blank
  text (`src/shared/text.ts`, `src/server/archive/text.ts`); the whole entry is refused with a
  400 naming the file. The browser runs the same rules on the start of each file before uploading.
  The server picks the stored mime type (`src/shared/mime.ts`; a browser-declared one is only
  kept if it is a text type), and the text is indexed for search. A refused upload is deleted at once (store and blob row,
  unless an entry already uses those bytes); the good files of a refused batch stay uploaded.
- **Type label**: the `file` type is shown as "Text file" (its id stays `file`).
- **Searching by tag**: the search box and `q` accept `#tag` words; all tags must be on the entry
  (AND), combined with the word search, the type filter and the `tag` parameter
  (`src/server/archive/search.ts`). The web UI no longer has a separate tag filter: tag chips on
  entries put `#tag` in the search box.
- **Searching content**: `archive_entries.search_text` (never returned by the API) feeds the
  generated `search` column, capped at 200,000 characters. A type fills it by returning
  `searchText` from `ingest`; `text` and `file` both do. Entries created before the column
  existed need a one-off backfill (done once for the existing entry).
- **Deleting frees blobs at once** when no other entry uses them and nobody re-uploaded the bytes
  since they were attached (`uploaded_at` is newer than the file row then, and the blob is left
  for the 24 h sweep). `POST /archive/gc?graceHours=n` (CLI `--grace-hours`) changes the sweep's
  grace period.
- **Ordering**: lists are newest first by id (uuidv7 is time-ordered), and the last id is the
  cursor. Search matches word prefixes on title + `source_url` (punctuation split into words),
  with no ranking.
- **Serving files** (2026-10-06): every file is sent as `text/plain; charset=utf-8` with `nosniff`,
  whatever its stored mime type or name (the mime is a label for the UI). Uploads are untrusted and
  served from the app's own origin, so nothing in the archive is ever rendered or run by a browser.
  Changed 2026-10-11 (videos): text-only was a rule for the `file` type alone. Files are now served
  with their stored mime when it is on an allow-list of types a browser only plays or parses
  (video, images, m3u8, VTT, JSON); anything else, including HTML, SVG, JS and XML, is still
  sent as plain text.
- **No generic enrichment** (2026-10-06): the first version had `POST /archive/entries/:id/files`,
  which attached any uploaded blob with any mime type to any entry. It was removed: every kind of
  content is a type with its own handling, and an enrichment is a particular thing for a particular
  type, designed with it. The `role` column (`original`, ...) stays; today every file is `original`.
- **Size** (2026-10-06): one ceiling, `MAX_FILE_BYTES` = 4 GiB, enforced by Caddy, the upload route
  (while streaming) and the browser. JSON bodies are capped at 8 MiB since they are parsed in memory.
- **Types registry** (server) holds label + input schema + `ingest`; the icon lives only in the
  web registry. Glyphs were added to the icon font for the archive UI (upload, search, plus, trash, download, floppy, angle-left, tag, doc, picture, video, music, file-pdf).
- **Required environment**: the app now exits at startup without `DATABASE_URL` or
  `STATE_DIRECTORY`. Migrations run at boot.
- **Recent searches can be removed**: `DELETE /archive/searches?query=...&type=...` (the UI has a
  remove button on each). The e2e tests use it to remove exactly the searches they ran; they must
  never clear the whole history, which is the user's.
- **Not built** (not in the plan's API either): changing `meta` after creation.
- **pnpm**: esbuild's build scripts (pulled in by drizzle-kit and vitest) are denied with
  `allowBuilds` in `pnpm-workspace.yaml`; without a decision pnpm 12 fails every frozen install.

## Prerequisites

- **Test database** (decided 2026-10-04, **in place** 2026-10-05):
  `memex_test`, provided by devstack. Integration tests apply migrations,
  insert rows and truncate tables between tests. Setup refuses to run unless
  the database name ends in `_test`.
- **Writable file store** (**in place** 2026-10-05): `StateDirectory` on a
  persistent volume, fixed `memex-app` user.

## Open questions

None at the moment. Review the plan above.

Decided 2026-10-05: runner-backed types are **not** in v1. v1 ships `file`
and `text`. The first runner type (videos, with `archive_jobs`) is the next
step once the archive is built.
