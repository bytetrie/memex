// zod schemas shared by the server (src/server) and the web client (web/src).
// The server validates requests with them; the client gets the inferred types.
// Imports use explicit .ts extensions: Node runs these files directly.

import { z } from "zod";

export const HealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean().nullable(), // null when no DATABASE_URL is configured
  time: z.iso.datetime(),
});
export type Health = z.infer<typeof HealthSchema>;

// One id per app component in the sidebar. Add new components here first.
export const ModuleIdSchema = z.enum(["archive", "notes", "chat", "memex", "external"]);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

// Components that still serve placeholder data from /api/modules/:id (the archive has a real backend).
export const PlaceholderModuleIdSchema = ModuleIdSchema.exclude(["archive"]);
export type PlaceholderModuleId = z.infer<typeof PlaceholderModuleIdSchema>;

export const ModuleItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
});
export type ModuleItem = z.infer<typeof ModuleItemSchema>;

export const ModuleSchema = z.object({
  id: ModuleIdSchema,
  title: z.string(),
  description: z.string(),
  items: z.array(ModuleItemSchema),
});
export type Module = z.infer<typeof ModuleSchema>;
