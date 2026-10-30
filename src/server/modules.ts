// Placeholder data for the sidebar components until each gets a real backend.

import type { Module, PlaceholderModuleId } from "../shared/api.ts";

const dummy = (id: PlaceholderModuleId, title: string, description: string): Module => ({
  id,
  title,
  description,
  items: [1, 2, 3].map((n) => ({
    id: `${id}-${String(n)}`,
    title: `${title} item ${String(n)}`,
    summary: `Dummy ${id} entry served by /api/modules/${id}.`,
  })),
});

export const modules: Record<PlaceholderModuleId, Module> = {
  chat: dummy("chat", "Chat", "Conversations."),
  external: dummy("external", "External", "Links out to other services."),
};
