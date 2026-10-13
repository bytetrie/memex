// Route documentation for /api/openapi.json. Every route calls docs(...) so it
// shows up in the spec with a summary and its responses (a test enforces it).
// The response schemas are the same zod schemas the client parses with.
// usage: .get("/x", docs("tag", "Summary", { 200: json("ok", XSchema) }), validate(...), handler)

import { describeRoute, resolver } from "hono-openapi";
import type { ZodType } from "zod";
import { ErrorSchema } from "../shared/archive.ts";

type Responses = Record<number, ReturnType<typeof json> | { description: string }>;

export const json = (description: string, schema: ZodType) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
});

export const failure = (description: string) => json(description, ErrorSchema);

export const docs = (tag: string, summary: string, responses: Responses, description?: string) =>
  describeRoute({ tags: [tag], summary, description, responses: Object.fromEntries(Object.entries(responses)) });
