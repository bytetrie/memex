// Request validation for routes: a zod schema checked by hono-openapi's
// validator (so the route's inputs also appear in /api/openapi.json), with a
// compact 400 body ({ error, issues: [{ path, message }] }).
// usage: app.get("/x/:id", validate("param", z.object({ id: z.string() })), (c) => c.req.valid("param"))

import type { ZodType } from "zod";
import type { ValidationTargets } from "hono";
import { validator } from "hono-openapi";

export function validate<S extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: S) {
  return validator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.map((i) => ({
        path: (i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join("."),
        message: i.message,
      }));
      return c.json({ error: `invalid ${target}`, issues }, 400);
    }
  });
}
