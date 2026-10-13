// API server entry, run by the systemd unit memex-app (see infra/).
// The routes live in src/server/app.ts; this file wires in the environment.
//
// - Binds to loopback only: Caddy is the only way in.
// - When INTERNAL_TOKEN is set (phase "isolation"), every request must carry the
//   X-Internal-Token header that Caddy adds; anything else gets a bare 500.
// - Needs DATABASE_URL (migrations run at boot) and STATE_DIRECTORY (systemd's
//   writable data folder; the archive's files live in <STATE_DIRECTORY>/archive).
// - Logs JSON lines to stdout (journald); level from LOG_LEVEL.
// Node >= 23.6 runs .ts files directly (type stripping), so no build step.

import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import pino from "pino";
import { createApp } from "./src/server/app.ts";
import { sweep } from "./src/server/archive/gc.ts";
import { createJobRepo } from "./src/server/archive/job-repo.ts";
import { createJobWorker } from "./src/server/archive/jobs.ts";
import { createArchiveRepo } from "./src/server/archive/repo.ts";
import { createDb } from "./src/server/db/client.ts";
import { runMigrations } from "./src/server/db/migrate.ts";
import { createBlobStore } from "./src/server/node/blob-store.ts";
import { createIncomingStore } from "./src/server/node/incoming.ts";
import { createRunnerClient } from "./src/server/node/runner-client.ts";

const HOST = process.env.APP_BIND ?? "127.0.0.1";
const PORT = Number(process.env.APP_PORT ?? "8080");
const TOKEN = process.env.INTERNAL_TOKEN ?? "";

const log = pino({ level: process.env.LOG_LEVEL ?? "info", base: null, timestamp: pino.stdTimeFunctions.isoTime });

function requireEnv(name: string, hint: string): string {
  // eslint-disable-next-line security/detect-object-injection -- name is one of the literals passed below
  const value = process.env[name];
  if (!value) {
    log.fatal({ env: name }, `${name} is not set: ${hint}`);
    process.exit(1);
  }
  return value;
}

function tokenOk(header: string | undefined): boolean {
  if (!TOKEN) return true; // not enforced until the isolation phase provides a token
  if (header === undefined) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const { db, close } = createDb(requireEnv("DATABASE_URL", "the postgres phase provides it (/etc/app-secrets/postgres.env)"));
const stateDir = requireEnv("STATE_DIRECTORY", "systemd sets it when the unit has StateDirectory= (app.data in devstack.toml)");

await runMigrations(db);
log.info({ event: "db.migrated" }, "migrations applied");

// incoming/ belongs to the runners (they write there, the app imports and deletes); see AGENTS.md "Runners".
const stores = {
  repo: createArchiveRepo(db),
  blobs: createBlobStore(join(stateDir, "archive")),
  jobs: createJobRepo(db),
  incoming: createIncomingStore(join(stateDir, "incoming")),
};
const worker = createJobWorker({ ...stores, runners: createRunnerClient(), log });
const archive = { ...stores, worker };

async function dbReachable(): Promise<boolean | null> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    log.warn({ err }, "database unreachable");
    return false;
  }
}

const app = createApp({ tokenOk, dbReachable, log, archive });

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  log.info({ host: HOST, port: PORT }, "listening");
});

await worker.start();

const HOUR = 60 * 60 * 1000;
setInterval(() => {
  sweep({ ...archive, log }).catch((err: unknown) => {
    log.error({ err }, "gc failed");
  });
}, HOUR).unref();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    worker.stop();
    server.close();
    void close()
      .catch((err: unknown) => {
        log.error({ err }, "closing the database failed");
      })
      .finally(() => process.exit(0));
  });
}
