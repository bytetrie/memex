// Command line for the archive: a thin layer over the typed Hono client, so a
// person or an agent can search and add entries. Prints JSON.
//   pnpm archive types
//   pnpm archive search [query] [--type file|text] [--tag t ...] [--limit n] [--cursor id]
//        the query may hold #tags too ("report #work"); all tags (also several --tag) must match
//   pnpm archive show <id>
//   pnpm archive add file <path...> [--title t] [--tag t ...]     (text files only)
//   pnpm archive add text <path|-> [--title t] [--tag t ...]     ("-" reads stdin)
//   pnpm archive add video <url> [--title t] [--tag t ...] [--wait]
//        queues a background job (download + HLS); --wait polls it and prints the entry
//   pnpm archive jobs [--status queued,running,failed,done,cancelled]
//   pnpm archive job show|cancel|retry|dismiss <id>
//   pnpm archive tag <id> <tag...>      adds tags
//   pnpm archive gc [--grace-hours n]   removes unreferenced blobs older than n hours (default 24)
// Talks to https://app.memex (ARCHIVE_URL to change); Caddy adds the
// internal token. Login shells trust the dev CA through NODE_EXTRA_CA_CERTS.

import { hc } from "hono/client";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { text as readAll } from "node:stream/consumers";
import { parseArgs } from "node:util";
import type { AppType } from "../src/server/app.ts";
import { JobSchema } from "../src/shared/archive-jobs.ts";
import { BlobSchema, EntrySchema } from "../src/shared/archive.ts";
import { ArchiveTypeIdSchema } from "../src/shared/archive-types.ts";

const base = process.env.ARCHIVE_URL ?? "https://app.memex";
const api = hc<AppType>(base).api.archive;

class CliError extends Error {}

async function ok(res: Response): Promise<unknown> {
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new CliError(JSON.stringify({ status: res.status, ...(typeof body === "object" ? body : {}) }));
  return body;
}

async function uploadBlob(path: string): Promise<{ sha256: string; size: number }> {
  const res = await fetch(api.blobs.$url(), { method: "PUT", body: await openAsBlob(path) });
  return BlobSchema.parse(await ok(res));
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    type: { type: "string" },
    tag: { type: "string", multiple: true },
    title: { type: "string" },
    limit: { type: "string" },
    cursor: { type: "string" },
    "grace-hours": { type: "string" },
    status: { type: "string" },
    wait: { type: "boolean" },
  },
});
const [command, ...rest] = positionals;
const tags = values.tag;

async function run(): Promise<unknown> {
  switch (command) {
    case "types":
      return ok(await api.types.$get());
    case "search": {
      const query: Record<string, string> = {};
      // --tag t is the same as #t in the query; several tags all have to match.
      const tagTokens = (values.tag ?? []).map((t) => (/\s/.test(t) ? `#"${t}"` : `#${t}`));
      const q = [...rest, ...tagTokens].join(" ");
      if (q) query.q = q;
      if (values.type) query.type = ArchiveTypeIdSchema.parse(values.type);
      if (values.limit) query.limit = values.limit;
      if (values.cursor) query.cursor = values.cursor;
      return ok(await api.entries.$get({ query }));
    }
    case "show": {
      if (!rest[0]) throw new CliError("usage: show <id>");
      return ok(await api.entries[":id"].$get({ param: { id: rest[0] } }));
    }
    case "add": {
      const [kind, ...args] = rest;
      if (kind === "file") {
        if (args.length === 0) throw new CliError("usage: add file <path...>");
        const files = [];
        for (const path of args) files.push({ sha256: (await uploadBlob(path)).sha256, name: basename(path) });
        return ok(await api.entries.$post({ json: { type: "file", title: values.title, tags, input: { files } } }));
      }
      if (kind === "text") {
        if (!args[0]) throw new CliError("usage: add text <path|->");
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the file its user names is this command's job
        const text = args[0] === "-" ? await readAll(process.stdin) : await readFile(args[0], "utf8");
        return ok(await api.entries.$post({ json: { type: "text", title: values.title, tags, input: { text } } }));
      }
      if (kind === "video") {
        if (!args[0]) throw new CliError("usage: add video <url> [--wait]");
        const job = JobSchema.parse(await ok(await api.jobs.$post({ json: { type: "video", title: values.title, tags, input: { url: args[0] } } })));
        return values.wait ? waitFor(job.id) : job;
      }
      throw new CliError("usage: add file <path...> | add text <path|-> | add video <url>");
    }
    case "jobs":
      return ok(await api.jobs.$get({ query: values.status ? { status: values.status } : {} }));
    case "job": {
      const [action, id] = rest;
      if (!id) throw new CliError("usage: job show|cancel|retry|dismiss <id>");
      const param = { param: { id } };
      if (action === "show") return ok(await api.jobs[":id"].$get(param));
      if (action === "cancel") return ok(await api.jobs[":id"].cancel.$post(param));
      if (action === "retry") return ok(await api.jobs[":id"].retry.$post(param));
      if (action === "dismiss") return ok(await api.jobs[":id"].$delete(param));
      throw new CliError("usage: job show|cancel|retry|dismiss <id>");
    }
    case "tag": {
      const [id, ...add] = rest;
      if (!id || add.length === 0) throw new CliError("usage: tag <id> <tag...>");
      const entry = EntrySchema.parse(await ok(await api.entries[":id"].$get({ param: { id } })));
      return ok(await api.entries[":id"].$patch({ param: { id }, json: { tags: [...entry.tags, ...add] } }));
    }
    case "gc":
      return ok(await api.gc.$post({ query: values["grace-hours"] ? { graceHours: values["grace-hours"] } : {} }));
    default:
      throw new CliError("commands: types | search [query] | show <id> | add file|text|video ... | jobs | job <action> <id> | tag <id> <tag...> | gc");
  }
}

// Polls a job until it finishes (progress on stderr); prints the entry, or fails with the job's error.
async function waitFor(id: string): Promise<unknown> {
  for (;;) {
    const job = JobSchema.parse(await ok(await api.jobs[":id"].$get({ param: { id } })));
    if (job.status === "done" && job.entryId) return ok(await api.entries[":id"].$get({ param: { id: job.entryId } }));
    if (job.status === "failed" || job.status === "cancelled") throw new CliError(JSON.stringify({ job: job.id, status: job.status, error: job.error }));
    const where = job.status === "queued" ? `queued (${String(job.ahead ?? 0)} ahead)` : `${job.stage ?? "starting"} ${job.progress === null ? "" : `${job.progress.toFixed(0)}%`} ${job.detail ?? ""}`;
    process.stderr.write(`${where.trim()}\n`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (err) {
  console.error(err instanceof CliError ? err.message : err);
  process.exit(1);
}
