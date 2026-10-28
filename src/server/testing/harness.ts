// Integration-test harness: the real app and repo on the test database, with a
// temp directory as the blob store. Call useHarness() inside a describe();
// every test starts with empty tables and an empty store.
// usage: const h = useHarness(); ... await h.json("/api/archive/entries")

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { BlobSchema } from "../../shared/archive.ts";
import { createApp } from "../app.ts";
import { createJobRepo } from "../archive/job-repo.ts";
import { createJobWorker, type JobWorker } from "../archive/jobs.ts";
import { createArchiveRepo } from "../archive/repo.ts";
import type { ArchiveDeps } from "../archive/ports.ts";
import type { Db } from "../db/client.ts";
import { createBlobStore } from "../node/blob-store.ts";
import { createIncomingStore } from "../node/incoming.ts";
import type { NotesDeps } from "../notes/ports.ts";
import { createNotesRepo } from "../notes/repo.ts";
import type { Logger } from "../types.ts";
import { fakeRunners } from "./fake-runners.ts";
import { connectTestDb, truncateAll } from "./test-db.ts";

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, child: () => silentLogger };

export type Harness = {
  db: Db;
  archive: ArchiveDeps;
  notes: NotesDeps;
  dir: string;
  // The runners' output folder (a temp dir); fake runners write their files here.
  incomingDir: string;
  // Register what each runner does in a test: h.runners.handle("ytdlp", async (req, emit) => ...).
  runners: ReturnType<typeof fakeRunners>;
  worker: JobWorker;
  app: ReturnType<typeof createApp>;
  // Calls the API in-process; `path` starts with /api.
  request(path: string, init?: RequestInit): Promise<Response>;
  // Sends a JSON body (method defaults to POST).
  send(path: string, body: unknown, method?: string): Promise<Response>;
  // Uploads bytes with PUT /api/archive/blobs; returns the hash.
  upload(content: string | Uint8Array<ArrayBuffer>): Promise<{ sha256: string; size: number }>;
};

export function useHarness(): Harness {
  let connection: ReturnType<typeof connectTestDb> | undefined;
  let current: Pick<Harness, "archive" | "notes" | "dir" | "app" | "incomingDir" | "worker"> | undefined;
  const runners = fakeRunners();
  const inTest = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error("the harness is only ready inside a test");
    return value;
  };

  beforeAll(() => {
    connection = connectTestDb();
  });
  beforeEach(async () => {
    const db = inTest(connection).db;
    await truncateAll(db);
    const dir = await mkdtemp(join(tmpdir(), "archive-test-"));
    const incomingDir = join(dir, "incoming");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(incomingDir);
    runners.reset();
    const base = { repo: createArchiveRepo(db), blobs: createBlobStore(join(dir, "store")), jobs: createJobRepo(db), incoming: createIncomingStore(incomingDir) };
    const worker = createJobWorker({ ...base, runners: runners.client, log: silentLogger });
    const archive: ArchiveDeps = { ...base, worker };
    const notes: NotesDeps = { repo: createNotesRepo(db) };
    current = { dir, incomingDir, worker, archive, notes, app: createApp({ tokenOk: () => true, dbReachable: () => Promise.resolve(true), log: silentLogger, archive, notes }) };
  });
  afterEach(async () => {
    const { worker, dir } = inTest(current);
    worker.stop();
    await worker.idle();
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(() => inTest(connection).close());

  const h: Harness = {
    get db() {
      return inTest(connection).db;
    },
    get archive() {
      return inTest(current).archive;
    },
    get notes() {
      return inTest(current).notes;
    },
    get dir() {
      return inTest(current).dir;
    },
    get incomingDir() {
      return inTest(current).incomingDir;
    },
    get worker() {
      return inTest(current).worker;
    },
    runners,
    get app() {
      return inTest(current).app;
    },
    request: async (path, init) => h.app.request(path, init),
    send: (path, body, method = "POST") =>
      h.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    upload: async (content) => {
      const res = await h.request("/api/archive/blobs", { method: "PUT", body: content });
      if (res.status !== 200) throw new Error(`upload failed: ${String(res.status)} ${await res.text()}`);
      return BlobSchema.parse(await res.json());
    },
  };
  return h;
}
