// /api/notes/*: the notes HTTP API (design: ideas/notes.md). Mounted by app.ts.
// Every route documents itself with docs() for the OpenAPI spec.

import { Hono } from "hono";
import { z } from "zod";
import { emptyDoc } from "../../shared/notes-doc.ts";
import {
  BacklinksSchema,
  BlockHitsSchema,
  BlockQuerySchema,
  CreatePageSchema,
  DrawingSchema,
  PageListQuerySchema,
  PageListSchema,
  PageSchema,
  PatchPageSchema,
  SaveDrawingSchema,
  SavedSchema,
  SavePageSchema,
  TagCountsSchema,
  VersionConflictSchema,
} from "../../shared/notes.ts";
import { docs, failure, json } from "../openapi.ts";
import type { AppEnv } from "../types.ts";
import { validate } from "../validate.ts";
import type { NotesDeps } from "./ports.ts";

const idParam = z.object({ id: z.uuid() });
const TAG = "notes";

export function createNotesRoutes({ repo }: NotesDeps) {
  return new Hono<AppEnv>()
    .get(
      "/pages",
      docs(TAG, "List or search pages", { 200: json("Pages, most recently edited first", PageListSchema) }),
      validate("query", PageListQuerySchema),
      async (c) => c.json(await repo.listPages(c.req.valid("query"))),
    )

    .post(
      "/pages",
      docs(TAG, "Create a page", { 201: json("The page", PageSchema) }, "Everything is optional: a new page is titled Untitled and starts empty."),
      validate("json", CreatePageSchema),
      async (c) => {
        const input = c.req.valid("json");
        const page = await repo.createPage({ title: input.title ?? "", tags: input.tags ?? [], doc: input.doc ?? emptyDoc() });
        c.var.log.info({ event: "notes.page.created", id: page.id }, "page created");
        return c.json(page, 201);
      },
    )

    .get(
      "/pages/:id",
      docs(TAG, "Get a page", { 200: json("The page with its doc (ProseMirror JSON)", PageSchema), 404: failure("No such page") }),
      validate("param", idParam),
      async (c) => {
        const page = await repo.getPage(c.req.valid("param").id);
        return page ? c.json(page) : c.json({ error: "page not found" }, 404);
      },
    )

    .put(
      "/pages/:id",
      docs(
        TAG,
        "Save a page's title and doc",
        { 200: json("The new version", SavedSchema), 404: failure("No such page"), 409: json("Saved elsewhere since baseVersion; `version` is the current one", VersionConflictSchema) },
        "The editor saves a moment after the last change. Blocks, links between pages and the page's archive refs are rebuilt from the doc.",
      ),
      validate("param", idParam),
      validate("json", SavePageSchema),
      async (c) => c.json(await repo.savePage(c.req.valid("param").id, c.req.valid("json"))),
    )

    .patch(
      "/pages/:id",
      docs(TAG, "Set a page's tags", { 200: json("The page", PageSchema), 404: failure("No such page") }, "Tags are not versioned: this doesn't conflict with a save."),
      validate("param", idParam),
      validate("json", PatchPageSchema),
      async (c) => {
        const page = await repo.setTags(c.req.valid("param").id, c.req.valid("json").tags);
        return page ? c.json(page) : c.json({ error: "page not found" }, 404);
      },
    )

    .delete(
      "/pages/:id",
      docs(TAG, "Delete a page", { 204: { description: "Deleted" }, 404: failure("No such page") }, "Releases its archive refs. Links to it from other pages remain and show as broken."),
      validate("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        if (!(await repo.deletePage(id))) return c.json({ error: "page not found" }, 404);
        c.var.log.info({ event: "notes.page.deleted", id }, "page deleted");
        return c.body(null, 204);
      },
    )

    .get(
      "/pages/:id/backlinks",
      docs(TAG, "Pages linking to a page", { 200: json("Links from other pages, with the linking block's text", BacklinksSchema) }),
      validate("param", idParam),
      async (c) => c.json({ items: await repo.backlinks(c.req.valid("param").id) }),
    )

    .get(
      "/blocks",
      docs(TAG, "Search blocks", { 200: json("Blocks whose text or page title contains every word", BlockHitsSchema) }, "For linking to a block (the (( menu)."),
      validate("query", BlockQuerySchema),
      async (c) => {
        const { q, limit } = c.req.valid("query");
        return c.json({ items: await repo.searchBlocks(q, limit) });
      },
    )

    .get(
      "/tags",
      docs(TAG, "Tags in use", { 200: json("Every tag on a page, with how many pages have it", TagCountsSchema) }),
      async (c) => c.json({ items: await repo.tagCounts() }),
    )

    .post(
      "/drawings",
      docs(TAG, "Create a drawing", { 201: json("An empty drawing", DrawingSchema) }, "A page shows it once its doc holds a drawing node with this id; until then it is detached, and deleted after a day."),
      async (c) => c.json(await repo.createDrawing(), 201),
    )

    .get(
      "/drawings/:id",
      docs(TAG, "Get a drawing", { 200: json("The Excalidraw scene", DrawingSchema), 404: failure("No such drawing") }),
      validate("param", idParam),
      async (c) => {
        const drawing = await repo.getDrawing(c.req.valid("param").id);
        return drawing ? c.json(drawing) : c.json({ error: "drawing not found" }, 404);
      },
    )

    .put(
      "/drawings/:id",
      docs(TAG, "Save a drawing", { 200: json("The new version", SavedSchema), 404: failure("No such drawing"), 409: json("Saved elsewhere since baseVersion", VersionConflictSchema) }),
      validate("param", idParam),
      validate("json", SaveDrawingSchema),
      async (c) => c.json(await repo.saveDrawing(c.req.valid("param").id, c.req.valid("json"))),
    );
}
