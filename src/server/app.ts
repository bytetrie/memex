// The Hono API. Everything lives under /api (Caddy forwards only /api/* here).
// Kept free of node: imports so web/ can import `AppType` for the typed client;
// environment-specific pieces are passed in by server.ts.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { openAPIRouteHandler } from "hono-openapi";
import { z } from "zod";
import { HealthSchema, ModuleSchema, PlaceholderModuleIdSchema, type Health } from "../shared/api.ts";
import { createArchiveRoutes } from "./archive/routes.ts";
import { ArchiveError, type ArchiveDeps, type ArchiveErrorCode } from "./archive/ports.ts";
import { MemexError, type MemexDeps, type MemexErrorCode } from "./memex/ports.ts";
import { createMemexRoutes } from "./memex/routes.ts";
import { modules } from "./modules.ts";
import { NotesError, type NotesDeps, type NotesErrorCode } from "./notes/ports.ts";
import { createNotesRoutes } from "./notes/routes.ts";
import { docs, json } from "./openapi.ts";
import type { AppEnv, Logger } from "./types.ts";
import { validate } from "./validate.ts";

export type AppDeps = {
  // Rejects requests that did not come through Caddy (see server.ts).
  tokenOk: (header: string | undefined) => boolean;
  // null when no database is configured.
  dbReachable: () => Promise<boolean | null>;
  log: Logger;
  archive: ArchiveDeps;
  notes: NotesDeps;
  memex: MemexDeps;
};

const archiveErrorStatus = {
  not_found: 404,
  conflict: 409,
  referenced: 409,
  unknown_blob: 422,
  invalid: 400,
  too_large: 413,
  queue_full: 429,
  wrong_mode: 400,
} as const satisfies Record<ArchiveErrorCode, number>;

const notesErrorStatus = {
  not_found: 404,
  version_conflict: 409,
} as const satisfies Record<NotesErrorCode, number>;

const memexErrorStatus = {
  not_found: 404,
  version_conflict: 409,
  invalid: 400,
  too_large: 413,
} as const satisfies Record<MemexErrorCode, number>;

// JSON bodies are parsed in memory, so they get a small limit: the biggest one is a `text` entry
// (TEXT_MAX_LENGTH characters, a few bytes each when escaped). Files go through PUT /archive/blobs.
const MAX_JSON_BYTES = 8 * 1024 ** 2;
// Everything Hono's json validator parses (application/json, application/<x>+json) matches, and a
// little more; one quantifier, so no catastrophic backtracking.
const JSON_CONTENT_TYPE = /^application\/[a-z.+-]*json/i;
const jsonLimit = bodyLimit({ maxSize: MAX_JSON_BYTES, onError: (c) => c.json({ error: `JSON bodies may be at most ${String(MAX_JSON_BYTES)} bytes` }, 413) });

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", createMiddleware<AppEnv>(async (c, next) => {
    if (!deps.tokenOk(c.req.header("x-internal-token"))) return c.body(null, 500);
    const reqId = crypto.randomUUID();
    const log = deps.log.child({ reqId });
    c.set("log", log);
    c.header("x-request-id", reqId);
    const start = performance.now();
    if (JSON_CONTENT_TYPE.test(c.req.header("content-type") ?? "")) {
      const refused = await jsonLimit(c, next); // a Response only when the body is too large
      if (refused instanceof Response) c.res = refused;
    } else {
      await next();
    }
    // Routes may set their own policy (file downloads revalidate by ETag).
    if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - start) }, "request");
  }));

  app.onError((err, c) => {
    if (err instanceof ArchiveError) {
      const status = archiveErrorStatus[err.code];
      if (err.code === "referenced") return c.json({ error: err.message, refs: err.detail }, status);
      if (err.code === "invalid") return c.json({ error: err.message, issues: err.detail }, status);
      // e.g. a duplicate: { entryId } or { jobId }
      if (err.code === "conflict" && typeof err.detail === "object" && err.detail !== null) return c.json({ ...err.detail, error: err.message }, status);
      return c.json({ error: err.message }, status);
    }
    if (err instanceof NotesError) {
      if (err.code === "version_conflict") return c.json({ error: err.message, version: err.detail }, notesErrorStatus[err.code]);
      return c.json({ error: err.message }, notesErrorStatus[err.code]);
    }
    if (err instanceof MemexError) {
      if (err.code === "version_conflict") return c.json({ error: err.message, version: err.detail }, memexErrorStatus[err.code]);
      return c.json({ error: err.message }, memexErrorStatus[err.code]);
    }
    // e.g. a request body that is not valid JSON
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    c.var.log.error({ err }, "unhandled error"); // set by the first middleware, before anything can throw
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));

  // Chain routes so their types accumulate into AppType.
  return app
    .get("/health", docs("app", "Health", { 200: json("Service and database status", HealthSchema) }), async (c) => {
      const body: Health = { ok: true, db: await deps.dbReachable(), time: new Date().toISOString() };
      return c.json(body);
    })
    .get(
      "/modules/:id",
      docs("app", "Placeholder data of a sidebar component", { 200: json("The module", ModuleSchema) }),
      validate("param", z.object({ id: PlaceholderModuleIdSchema })),
      (c) => c.json(modules[c.req.valid("param").id]),
    )
    .route("/archive", createArchiveRoutes(deps.archive))
    .route("/notes", createNotesRoutes(deps.notes))
    .route("/memex", createMemexRoutes(deps.memex))
    .get(
      "/openapi.json",
      docs("app", "OpenAPI description of this API", { 200: { description: "OpenAPI 3.1 document" } }),
      openAPIRouteHandler(app, {
        documentation: {
          info: {
            title: "memex API",
            version: "1.0.0",
            description: "Call it through Caddy (https://app.memex/api/...); the internal token is added there. Start with GET /api/archive/types.",
          },
        },
        includeEmptyPaths: true,
        excludeStaticFile: false, // "openapi.json" has a dot but is a route
      }),
    );
}

export type AppType = ReturnType<typeof createApp>;
