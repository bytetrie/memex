// Every route under /api must be documented in the OpenAPI spec, with a summary.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./app.ts";
import { silentLogger } from "./testing/harness.ts";
import { idleWorker, stubBlobs, stubIncoming, stubJobs, stubMemexRepo, stubNotesRepo, stubRepo } from "./testing/stubs.ts";

const app = createApp({ tokenOk: () => true, dbReachable: () => Promise.resolve(null), log: silentLogger, archive: { repo: stubRepo(), blobs: stubBlobs(), jobs: stubJobs(), worker: idleWorker, incoming: stubIncoming() }, notes: { repo: stubNotesRepo() }, memex: { repo: stubMemexRepo(), blobs: stubBlobs() } });

// The parts of the OpenAPI document these tests read.
const ContentSchema = z.object({ content: z.record(z.string(), z.object({ schema: z.unknown() })).optional() });
const OperationSchema = z.object({ summary: z.string().optional(), requestBody: ContentSchema.optional(), responses: z.record(z.string(), ContentSchema).optional() });
const SpecSchema = z.object({ openapi: z.string(), paths: z.record(z.string(), z.record(z.string(), OperationSchema)) });
const getSpec = async () => SpecSchema.parse(await (await app.request("/api/openapi.json")).json());

// "/api/archive/entries/:id/files/:name{.+}" -> "/api/archive/entries/{id}/files/{name}"
const specPath = (honoPath: string) => honoPath.replace(/\{[^}]*\}/g, "").replace(/:(\w+)/g, "{$1}");

describe("OpenAPI spec", () => {
  it("documents every route", async () => {
    const spec = await getSpec();
    expect(spec.openapi).toMatch(/^3\.1/);
    const routes = app.routes.filter((r) => r.method !== "ALL");
    expect(routes.length).toBeGreaterThan(10);
    const undocumented = routes
      .filter((r) => !spec.paths[specPath(r.path)]?.[r.method.toLowerCase()]?.summary)
      .map((r) => `${r.method} ${r.path}`);
    expect(undocumented).toEqual([]);
  });

  it("describes request bodies and response schemas", async () => {
    const create = (await getSpec()).paths["/api/archive/entries"]?.post;
    expect(create?.requestBody?.content?.["application/json"]?.schema).toBeDefined();
    expect(create?.responses?.["201"]?.content?.["application/json"]?.schema).toBeDefined();
  });
});
