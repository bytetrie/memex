# Video handler

Status: built (2026-10-11) except for the host step: the two runners still have to be declared
(`devstack.toml`, see AGENTS.md "Runners"), and then checked in their sandbox. See "As built" at
the end for what differs from the plan and what is not verified yet.

## Brief

I want to be able to add videos to the archive. The first tool for
getting videos will be: https://github.com/yt-dlp/yt-dlp/

Note how the archive system works.

I will give the URL and then fetch the video into the archive.
We want to have the full video + audio + transcript + meta info.

We also want to convert the video to HLS using ffmpeg after downloading it, and view the
video in the browser using hls.js. We will need to add ffmpeg and possibly git to the environment.

Runners will be required in order to:
- fetch the video (yt-dlp)
- encode the video (ffmpeg)

Ensure we can update yt-dlp if it needs it.

Because the download happens asynchronously, and we only want to add one at a time, the UI
should reflect this. If anything fails, we also need to communicate this. Once the download
is finished and the entry is available, we should be able to view the video (as an HLS stream) in
the entry view.

---

## Plan

Guiding rule (same as the archive): boring parts only. A video is a new archive **type**
(`video`) whose work happens in two **runners**. The app drives them from a small **job**
table: jobs are queued and an in-process worker runs one at a time. The entry is created only when
everything has been imported. Files are served with their real content types; playback is hls.js.

### Decisions (2026-10-11)

| Topic | Decision |
|---|---|
| Content types | Text-only was a rule for the `file` type alone. Every other type is defined by its format, how it is acquired, and the extra data its entries carry. Its files are **served with their correct content types** (m3u8 as `application/vnd.apple.mpegurl`, media as `video/mp4`, ...) |
| yt-dlp | The official release build, pinned by version + sha256 in `infra/yt-dlp.lock`, fetched into gitignored `vendor/` by a script. First the zipapp on Debian's `python3`; switched to the bundled `yt-dlp_linux.zip` (with curl_cffi) the same day, see "As built" |
| What is kept | **HLS only** (a lossless remux of the download) + transcript + info + images. The download itself is deleted after conversion |
| One at a time | **Queue**: any number of jobs can be submitted; the worker runs them one after another |
| Quality | **≤ 1080p** |
| Sites | **Any https URL** yt-dlp supports |
| Transcript | **English**: manual subtitles first, auto-generated as a fallback |
| Images | **Poster** (full size, on the player), a **small static thumbnail** on entry cards, and a **small animated AVIF** made of frames from throughout the video that replaces the thumbnail while the card is hovered or focused |

### What exists today (checked 2026-10-11)

- `runners = []`, and the runner contract is in AGENTS.md. `$STATE_DIRECTORY/incoming/` exists
  (`memex-runner:memex-data`, 2770). The app is in `memex-data`.
- apt candidates (trixie): `ffmpeg` 7.1.5 (with libaom, SVT-AV1 and dav1d) and `yt-dlp`
  2025.04.30 (too stale, so we don't use it). `python3` 3.13 is installed but not listed in
  `infra/apt-packages.txt`. `git` is already listed.
- CSP: `media-src blob: 'self'` and `worker-src 'self' blob:` (what hls.js needs), and `img-src 'self'
  data:` (enough for images served by the app). **No CSP change.**
- Every file is sent as `text/plain; charset=utf-8` with `nosniff` (`src/server/archive/http.ts`).
  That changes (next section).
- `GET /archive/entries` returns `EntrySummary` (no files), so cards don't know about thumbnails yet.
- The type registry is synchronous: `ingest` runs inside the HTTP request.
- eslint allows `child_process` only in `src/server/node/child-process.ts` (not yet created).

### Serving files with their content types

- The **server** picks each file's mime: the type handler sets it, never the request.
  (The `file` type already does: `textMimeFor`.)
- `http.ts` replaces `SERVED_CONTENT_TYPE` with `servedContentType(mime)`, backed by an **allow-list**
  (a `Map`) of types that are safe to serve from the app's origin:
  `video/mp4`, `audio/mp4`, `application/vnd.apple.mpegurl`, `image/jpeg`, `image/avif`,
  `text/vtt`, `application/json`, `text/plain`, and the other text mimes `textMimeFor` produces,
  all with `; charset=utf-8` for text. Anything else, including anything that could be rendered or run
  (`text/html`, `image/svg+xml`, `*/javascript`, `*/xml`), is still sent as
  `text/plain; charset=utf-8`. `nosniff` stays on every response.
- So `text` and `file` entries look the same as today (their files are text types). The rule in
  AGENTS.md "Archive" changes from "everything is text/plain" to "the type sets the mime; only
  allow-listed types are served as themselves".
- `ideas/archive.md` "As built" and AGENTS.md are updated to say this.

### Entry layout (type `video`)

| File | Role | Mime | Notes |
|---|---|---|---|
| `hls/index.m3u8` | `original` | `application/vnd.apple.mpegurl` | Media playlist, **single-file fMP4 with `EXT-X-BYTERANGE`** |
| `hls/media.mp4` | `original` | `video/mp4` | The one media file (video + audio). hls.js reads it with Range requests, which the file route already supports |
| `transcript.en.vtt` | `derived` | `text/vtt` | English subtitles (manual, else auto-generated, de-duplicated); missing if none exist |
| `info.json` | `metadata` | `application/json` | yt-dlp's info JSON, trimmed (`formats`, `thumbnails`, `http_headers`, `requested_*` dropped) |
| `poster.jpg` | `thumbnail` | `image/jpeg` | The site's thumbnail if yt-dlp got one, else a frame at 10 %; max 1280 px wide |
| `thumb.jpg` | `thumbnail` | `image/jpeg` | The poster at 320 px wide, for cards |
| `preview.avif` | `thumbnail` | `image/avif` | Animated: 12 frames from 5 % to 95 % of the video, 320 px, 0.5 s each, looping |

- **Single file + byte ranges** instead of hundreds of segment files: an entry gets 7 files instead
  of ~600 for an hour of video.
- **Remux, don't transcode.** The format selector prefers H.264 + AAC up to 1080p, so the HLS step
  is `ffmpeg -c copy`: seconds, low memory, and **lossless**, so "HLS only" still keeps the full
  video and audio as downloaded. Other codecs that fMP4 and Chromium/Firefox MSE support (VP9, AV1,
  Opus) are remuxed too. Transcoding (`libx264 -preset veryfast` + AAC) is the fallback only for a
  codec outside that list. Since the download isn't kept, that rare case loses quality, and the
  entry's `meta.transcoded` says so.
- **Entry fields**: `title` = info `title`; `sourceUrl` = info `webpage_url`; `meta` = a validated
  subset (`extractor`, `videoId`, `channel`, `uploader`, `uploadDate`, `duration`, `width`, `height`,
  `vcodec`, `acodec`, `subtitleKind: manual|auto|none`, `ytDlpVersion`, `transcoded`).
  `searchText` = title + description + transcript text (cues de-duplicated, timestamps and tags
  stripped; capped at 200,000 as usual).
- Before import, the app checks that ffprobe saw exactly one video and one audio stream in
  `media.mp4` and that each image is what its name says (JPEG/AVIF magic bytes). A file that fails
  fails the job.

### Runners

Both follow the AGENTS.md contract: one connection = one job, request on stdin, reply on stdout,
files only in `$INCOMING_DIR`, no loopback, no secrets.

```
scripts/runners/ytdlp.ts          node scripts/runners/ytdlp.ts    (download)
scripts/runners/encode.ts         node scripts/runners/encode.ts   (ffmpeg: HLS + images)
scripts/runners/lib.ts            shared: read one request line, emit events, job dir, exit on hang-up
src/shared/runners.ts             zod: requests, events, RUNNER_PORTS (must match devstack.toml)
src/server/node/child-process.ts  execFile/spawn wrapper (the eslint-allowed path); runners import it
```

Runners import only `src/shared/` and `src/server/node/child-process.ts`. The latter is a pure Node
helper with no DB or app state, so eslint's `child_process` rule needs no change.

**Protocol** (NDJSON both ways, every line validated with zod, lines capped at 64 KiB):

```
app → runner   {"v":1,"op":"fetch","url":"https://…","maxHeight":1080,"subLangs":["en"]}
               {"v":1,"op":"encode","dir":"<job dir name>"}
runner → app   {"event":"progress","stage":"download","percent":41.2,"detail":"12.3MiB/s ETA 00:42"}
               {"event":"log","line":"[youtube] abc: Downloading webpage"}
               {"event":"done","dir":"<job dir name>","files":[{"name":"video.mp4","kind":"video"}, …]}
               {"event":"error","message":"ERROR: [youtube] abc: Video unavailable"}
```

- **Job dir**: `ytdlp` creates `incoming/<random>/` (`mkdtemp`, then `chmod 2770` so the app can
  delete what's in it; the runner's umask would otherwise make it 2750) and reports the name.
  `encode` gets that name. It accepts it only if it matches `^[A-Za-z0-9_-]{6,64}$`, exists directly
  under `$INCOMING_DIR` and is not a symlink. Both runners run as the same user, so `encode` can
  read it. A request only ever names a dir a runner made, never a path.
- **ytdlp** runs the pinned zipapp with an argument array (never a shell) and `--` before the URL:
  `--ignore-config --no-cache-dir --no-playlist --no-exec --newline --progress-template …`
  `-f "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=1080]+ba/b[height<=1080]"`
  `--merge-output-format mp4/mkv --write-info-json --write-thumbnail --convert-thumbnails jpg`
  `--write-subs --write-auto-subs --sub-langs "en,en-.*" --convert-subs vtt --max-filesize 4G`
  `--js-runtimes node -o "<dir>/video.%(ext)s"`.
  YouTube needs a JS runtime now; Node 24 is at `/usr/local/bin/node`. yt-dlp calls ffmpeg itself
  to merge the video and audio streams.
- **encode**:
  1. `ffprobe` (JSON) → check the streams, choose remux or transcode.
  2. HLS: `ffmpeg -i video.* -c copy -f hls -hls_segment_type fmp4 -hls_flags single_file
     -hls_playlist_type vod -hls_time 6 hls/index.m3u8`. Progress comes from `-progress pipe:`
     against the probed duration.
  3. Poster from yt-dlp's thumbnail, or a frame at 10 %. `thumb.jpg` scaled from the poster.
  4. `preview.avif`: 12 frames grabbed with fast seeks (`-ss t -frames:v 1`, so it doesn't decode
     the whole video) as `frame_%04d.png`, scaled to 320 px, then encoded with the settings you
     tested on your machine (fast, plays in browsers), minus the alpha stream, because video frames
     have no transparency:
     `ffmpeg -y -framerate 2 -i frame_%04d.png -c:v libsvtav1 -crf 30 -preset 6 -b:v 0 -loop 0 preview.avif`.
     The frame count and frame rate are constants in `encode.ts` (12 frames at 2 fps = a 6 s loop).
  5. It deletes `video.*` and the raw subtitle variants it didn't pick, and reports the final files.
- **Hang-up**: when stdin closes (the app cancelled or restarted), the runner kills its child and
  exits. `RuntimeMaxSec` stays the hard stop.

**App side**

- `src/server/node/runner-client.ts`: `run(name, request, onEvent, signal)` over `node:net` to
  `127.0.0.1:<port>`. Implements a node-free `RunnerClient` interface in `ports.ts`, passed in
  through `AppDeps`.
- `src/server/node/incoming.ts`: `importFile(dir, name) → {sha256,size}` checks names against the
  fixed list the runner may produce, `lstat`s (a regular file, not a symlink), `realpath`s (must be
  inside `incoming/`), streams through `BlobStore.put` (a copy, so the app owns the blob) and
  `registerBlob`. `removeDir(dir)` cleans up afterwards, success or failure. The hourly gc also
  removes `incoming/*` older than 24 h.
- Everything that comes back (event lines, info JSON, VTT, ffprobe output) is untrusted: parsed
  with zod, size-capped, and strings length-capped before they reach the DB or the UI.

### Jobs

Table (one additive migration):

```sql
archive_jobs (id uuid pk default uuidv7(), type text, input jsonb, title text null, tags text[],
              status text,            -- queued | running | done | failed | cancelled
              stage text null,        -- download | encode | import
              progress real null,     -- 0..100 within the stage
              detail text null,       -- e.g. "12.3MiB/s ETA 00:42"
              log_tail text not null default '',   -- last ~100 lines, for failures
              error text null,        -- one human-readable line
              entry_id uuid null → archive_entries on delete set null,
              created_at, started_at null, finished_at null)
```

- **Queue + worker** (`src/server/archive/jobs.ts`, node-free; started from `server.ts`): the worker
  takes the oldest `queued` job (`for update skip locked`, though there is only one worker), runs the
  type's `run(input, ctx)`, writes progress to the row (at most about once a second), creates the
  entry, and moves on to the next. A new job wakes the worker. At boot, jobs left `running` become
  `failed` ("interrupted by a restart") and their incoming dirs are removed. Queued jobs simply run.
- **Limits**: at most 50 queued jobs (`429` beyond that), so a runaway agent can't queue
  unbounded downloads.
- **Duplicates**: `POST` answers `409 {entryId | jobId}` if a `video` entry has the same `sourceUrl`,
  or a queued or running job has the same URL. A second check runs after download against the
  canonical `webpage_url` (a short link vs the full URL). The job then fails with a link to the
  existing entry, and its files are thrown away.
- **Type shape**: `defineJobType({ label, input, check?(input, ctx), run(input, ctx) → IngestResult })`.
  `ctx` = `{ runner, importFile, removeDir, progress(stage, pct, detail), log, signal }`.
  `check` runs in the request (URL policy, duplicates), so bad input fails at once with 400/409.
  `POST /archive/entries` with a job type answers 400 "add this type through POST /archive/jobs".
  `GET /archive/types` gains `mode: "direct" | "job"`.
- **URL policy** (`VideoInputSchema` in `src/shared/archive-types.ts`): `https:` only, no
  credentials in the URL, at most 2,000 characters. Runners can't reach private ranges anyway.

API (all documented with `docs()`, schemas in `src/shared/archive-jobs.ts`):

| Method + path | Purpose |
|---|---|
| `POST /archive/jobs` | `{type, title?, tags?, input}` → `202 Job` (with its queue position); `409` duplicate; `429` queue full; `400` invalid |
| `GET /archive/jobs?status=` | Jobs, newest first (default: queued, running, and failures not yet dismissed) |
| `GET /archive/jobs/:id` | One job (poll this) |
| `POST /archive/jobs/:id/cancel` | Cancel a queued or running job (closes the runner connection) |
| `POST /archive/jobs/:id/retry` | A failed or cancelled job goes back into the queue |
| `DELETE /archive/jobs/:id` | Dismiss a finished job (`409` while queued or running) |

`EntrySummary` (lists) gains `thumbnails: { name, mime }[]`: the entry's files with role
`thumbnail` other than the poster, so cards can show `thumb.jpg` and `preview.avif` without loading
the full entry. It is generic: any future type with thumbnails gets them on cards.

CLI: `pnpm archive add video <url> [--tag t] [--wait]` (`--wait` polls and prints the entry),
`pnpm archive jobs`, `pnpm archive job cancel|retry|dismiss <id>`.

### Web UI

- **Add form** (`types/video/AddForm.tsx`): a URL field (labelled, with error text), plus optional
  title and tags like the other forms. Submitting queues the job and shows its panel under the form.
  The form stays usable, so you can queue the next one.
- **Job panel** (`JobStatus.tsx`, shared): one `<li>` per job, showing its status ("Queued, 2
  ahead" / "Downloading" / "Converting" / "Importing"), a Mantine `Progress` with an accessible
  label and value, the detail line, and Cancel. It polls `GET /archive/jobs` every 2 s while
  anything is queued or running, with no SSE or websockets. A finished job turns into a link to its
  entry. A failed one shows the error in a `role="alert"`, a collapsible log tail, **Retry** and
  **Dismiss**.
- **`/archive`**: a "Jobs" section (heading + list) above recent additions whenever a job is
  queued, running or failed, so a failure you didn't watch still shows up.
- **Cards** (`EntryCard.tsx`): if the entry has `thumb.jpg`, it is shown as a small image (alt text
  = the title). On `mouseenter` / `focus-within` it switches to `preview.avif`, and back on leave or
  blur. The AVIF is only requested on the first hover. It doesn't switch when
  `prefers-reduced-motion: reduce` is set. Layout goes in `Archive.module.css`.
- **Entry view** (`types/video/View.tsx`): `<video controls poster=…>` with hls.js
  (`loadSource(fileUrl(id, "hls/index.m3u8"))`, loaded with a dynamic `import()` so only the entry
  page pays for it). Captions: `<track kind="subtitles" srclang="en" src=…transcript.en.vtt>`,
  which works as is now that VTT is served as `text/vtt`. Below the player: channel, upload date,
  duration and source link, then the **transcript** as a list of cues with timestamp buttons that
  seek the video, then the generic file list (downloads; `info.json` and the VTT keep their text
  preview).

### Environment changes

| What | Where | Who |
|---|---|---|
| `ffmpeg`, `python3` | `infra/apt-packages.txt` → `./scripts/sync-env.sh` | me; then **host**: `./devstack sbom generate` |
| yt-dlp pinned zipapp | `infra/yt-dlp.lock` (version + sha256, committed); `scripts/update-yt-dlp.sh` downloads and verifies it into gitignored `vendor/yt-dlp/`; `sync-env.sh` calls it | me |
| `hls.js` (devDependency, bundled for the browser; a version ≥ 7 days old) | `package.json` + lockfile | me, flagged for review |
| Two runners, see below | `devstack.toml` → `./devstack up --redo isolation` (typed `yes`) | **host** |

Runner declaration for the host:

```toml
runners = [
  { name = "ytdlp",  command = "node scripts/runners/ytdlp.ts",  port = 9101, memory_max = "1G", runtime_max = "2h", max_connections = 1 },
  { name = "encode", command = "node scripts/runners/encode.ts", port = 9102, memory_max = "1G", runtime_max = "1h", max_connections = 1 },
]
```

**Updating yt-dlp** (`pnpm yt-dlp:update [version]`, default the latest release): it fetches the
release's `SHA2-256SUMS`, writes the version + hash to `infra/yt-dlp.lock`, and downloads and
verifies the file. The lock change gets reviewed like a lockfile change. No restart is needed: every
job starts a fresh process. `meta.ytDlpVersion` on each entry makes "entries from version X" a
search. Unlike npm, there's no 7-day wait, because yt-dlp fixes for site changes are urgent.

### Tests

- **Unit**: protocol schemas; yt-dlp argument builder (format selector, `--` before the URL);
  progress-line parser; ffprobe stream check + remux/transcode decision; VTT → transcript text
  (auto-sub de-duplication); info JSON trimming + `meta` subset; URL policy; incoming name/path
  validation (`..`, symlinks, absolute paths, odd names); `servedContentType` (allow-listed types
  pass, `text/html`/`image/svg+xml`/JS become text/plain).
- **Integration** (`archive.test.ts` + `jobs.test.ts`, real test DB): a stub `RunnerClient`
  (`src/server/testing/stubs.ts`) that writes fixture files into a temp incoming dir and emits
  events. It covers: queue order with two jobs; done (entry with all files, `searchText`, meta,
  card thumbnails, `Content-Type` per file); failure (error + log tail, incoming cleaned up, no
  entry, no orphan blobs); cancel queued and running; retry; duplicate 409; queue full 429;
  boot-time "interrupted" handling; `POST /archive/entries` refusing `video`.
- **Runner scripts**: `encode.ts` gets a test that generates a 3-second clip with
  `ffmpeg -f lavfi` (no network), runs the script with `INCOMING_DIR` set to a temp dir, and checks
  the playlist byteranges, ffprobe of `media.mp4`, and the JPEG/AVIF outputs (animated: more than one
  frame). `ytdlp.ts` is checked by hand in the sandbox as AGENTS.md says (`nc`, a short Creative
  Commons video, and a loopback connection that must be refused).
- **e2e** (real-data rules apply): the video form refuses a non-https URL. The download-and-play
  test **skips** unless `E2E_VIDEO_URL` is set. When set, it queues a short video, waits for the
  job, plays a second (`video.currentTime > 0`), checks the card's hover preview, and deletes the
  entry. Normal runs stay offline.

### Risks / things to verify early

1. **yt-dlp in the sandbox**: JS challenge solving with Node as the runtime under
   `SystemCallFilter=@system-service`, and the EJS scripts bundled in the zipapp.
2. **Animated AVIF from Debian's ffmpeg 7.1**: the command works on your machine. Check that
   Debian's build has `libsvtav1` and gives the same result in the runner. If not, fall back to animated WebP (`libwebp_anim`, also
   allowed by `img-src 'self'`).
3. **Incoming permissions**: the job dir (2770 after chmod) and its files must be deletable by the app.
4. **Caddy `encode`**: it should leave `video/mp4` and images alone (its default only compresses
   text-like types). Confirm that Range requests on `media.mp4` come back as 206 through Caddy.
5. **Disk**: during a job, the download and the HLS copy both sit in `incoming/` until import, plus
   the blob copy, so about 3× the video size briefly. `--max-filesize 4G` and the 4 GiB cap bound it.
6. hls.js and the CSP: workers from `blob:` (allowed), no `<style>` tags; `pnpm check:csp` + e2e
   confirm.

### Build order (each step leaves everything green)

1. `servedContentType` + allow-list (with tests); `EntrySummary.thumbnails`. Doc updates for the
   new serving rule.
2. apt (`ffmpeg`, `python3`), the yt-dlp pin + update script, `child-process.ts`. Host: sbom.
3. Runner protocol + `scripts/runners/*.ts` + unit tests + the `encode` clip test. Host: declare
   the runners. Then the sandbox check with `nc`.
4. `archive_jobs` migration, repo, queue worker, runner client, incoming import, jobs API, OpenAPI,
   integration tests with the stub runner.
5. `video` type: input schema, `defineJobType`, `run` (fetch → encode → checks → import → entry),
   transcript and meta helpers.
6. Web: AddForm, JobStatus, the jobs section, card thumbnails with hover preview; `View.tsx` with
   hls.js (new dev dependency, flagged).
7. CLI. AGENTS.md: jobs and job types, the runners now declared, content-type serving, the recipe
   "Add a job-backed archive type". `ideas/archive.md` status. Then the "done means" checks.

### Not in this step

Playlists/channels, multiple renditions (adaptive bitrate), Whisper transcription when there are no
subtitles (the GPU is passed through, so this could be a later enrichment designed with this
type), re-fetching an entry, cookies or logins for private videos (they would be secrets in a
runner, which the contract forbids), other subtitle languages.

## Open points

- **Runner limits** (host config): the plan assumes `ytdlp` 1 GiB / 2 h and `encode` 1 GiB / 1 h,
  one connection each. Multi-hour streams over a slow link would need more time.
- **Queue cap**: 50 queued jobs. Say if you want a different number, or none.

## As built (2026-10-11)

What differs from the plan above, what was learned, and what is still open.

- **Verified outside the sandbox**: `ytdlp` fetched a plain https .mp4 through yt-dlp's generic
  extractor; `encode` remuxed a 1080p H.264/AAC file into single-file fMP4 HLS and made the
  poster, thumbnail and animated AVIF in 3.4 s. Your SVT-AV1 settings work with Debian's ffmpeg
  7.1: 12 frames at 320 px come to 15-70 KB in about 0.3 s. The AVIF holds a still image (stream 0)
  plus the 12-frame animation (stream 1), with the `avis` brand.
- **Not verified yet**: yt-dlp's Node-based YouTube challenge solving inside the sandbox, and
  playback of a real entry in Chromium (the e2e test `download a video, play it...` runs when
  `E2E_VIDEO_URL` is set).
- **YouTube's bot check**: a dry run on YouTube worked (EJS 0.8.0 bundled in the zipapp, Node 24 as
  the JS runtime, H.264 + AAC picked), but a minute later YouTube answered this IP with "Sign in
  to confirm you're not a bot". Its fix, cookies from a logged-in browser, would be a secret
  in a runner, which the contract forbids. If it keeps happening, the options are to wait (it is
  often temporary), a PO-token provider for yt-dlp (another component to review), or deciding to
  allow cookies (a contract change). Other sites are not affected.
- **yt-dlp filters**: a comparison on a field the site doesn't report fails the whole video, so
  the format selector uses `height<=?1080` and the live filter `live_status!=?is_upcoming`.
- **Job folders**: the unit's umask (0027) would make folders 2750, which the app can't empty. A
  `chmod 2770` fails in the sandbox (`RestrictSUIDSGID=yes` refuses setting the setgid bit: EPERM,
  the first real job hit it), so the runners set their umask to 007 and create folders with mode
  770; the kernel adds setgid and the `memex-data` group from `incoming/`. Folders come out
  2770, files 0660, for the tools they start too. Checked in the sandbox on 2026-10-11: both
  runners worked on a sample .mp4, and a fetch of `https://127.0.0.1/` was refused (no loopback).
- **Hang-up**: a runner treats a failed write as the app hanging up (with a heartbeat every 5 s),
  not stdin's EOF, so `printf '<request>' | nc` and tests that close stdin still work.
- **API additions**: `POST /archive/jobs/:id/retry`; jobs report `ahead` (how many run before
  them); `GET /archive/jobs` lists queued, running and failed by default (`?status=` for others).
  The gc removes finished jobs after 7 days and job folders after 24 h; at boot the worker marks
  a running job failed and empties `incoming/`.
- **Subtitles are a second, optional step** (2026-10-11, after the first real YouTube job failed):
  `--sub-langs en,en-.*` also matched YouTube's machine translations into English (`en-en-US`,
  `en-hi`, ...), yt-dlp fetched them in a row, YouTube answered 429, and a subtitle error aborts
  yt-dlp. Now step 1 fetches video, info and thumbnail; step 2 fetches subtitles from the saved
  info JSON (`--load-info-json`, 2 s between tracks), and if it fails the video is archived
  without a transcript (the job log says why). yt-dlp matches `--sub-langs` patterns
  case-insensitively, so the English regional tracks are listed by name (`en`, `en-US`, `en-GB`,
  `en-CA`, `en-AU`, `en-IE`, `en-NZ`, `en-IN`, `en-orig`). On that video this asks for 3 tracks
  instead of 6.
- **Progress names the part** (2026-10-11): yt-dlp downloads video and audio one after the other
  (e.g. format `137+140`), each from 0 to 100 %, which looked like the bar restarting. The detail
  now says `Video (1 of 2)`, `Audio (2 of 2)`, then `Merging video and audio`, with the ETA as
  mm:ss. YouTube can serve the audio stream slowly (about 80 KiB/s seen).
- **Impersonation → bundled build** (decided 2026-10-11): for some requests (YouTube's subtitles)
  yt-dlp wants to look like a browser, which needs `curl_cffi`. The plain zipapp can't carry it and
  Debian doesn't package it. The pin is now the release's `yt-dlp_linux.zip` (its own Python +
  curl_cffi 0.16.0, about 40 MB, same signed SHA2-256SUMS), unpacked into
  `vendor/yt-dlp/<version>/` with `current` pointing at it; `python3` left the apt list and `unzip`
  joined it. It runs in the runner sandbox (103 MB peak on a small file).
- **YouTube rate limit** (2026-10-11): after a handful of requests in an afternoon YouTube answered
  this connection's IP with 429 and "Sign in to confirm you're not a bot", even for the page itself.
  That is about the IP, not the tools; it usually passes after some hours. Space out YouTube jobs.
- **Subtitles**: the transcript is "manual" when the info JSON lists English under `subtitles`,
  else "automatic". Auto captions are de-duplicated for search and the transcript view
  (`src/shared/vtt.ts`).
- **Entry page**: the player section is headed "Video" (`viewHeading` in the web type registry), with
  the transcript (each line's time seeks the video) and the generic file list below it.
- **Dependencies added**: `hls.js` 1.7.3 (dev), apt `ffmpeg`, `gpg`, `unzip`. The yt-dlp bundled
  build 2026.08.19 is pinned in `infra/yt-dlp.lock` and its signing key is in `infra/yt-dlp/public.key`.
