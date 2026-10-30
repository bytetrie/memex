// Code-based TanStack Router setup: every route is listed here once.
// Adding a sidebar component: see AGENTS.md "Add an app component".

import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./root.tsx";
import { homeRoute } from "./pages/home.tsx";
import { archiveRoute } from "./modules/archive/route.tsx";
import { notesRoute } from "./modules/notes/route.tsx";
import { chatRoute } from "./modules/chat/route.tsx";
import { memexPrintRoute, memexRoute } from "./modules/memex/route.tsx";
import { externalRoute } from "./modules/external/route.tsx";

export const routeTree = rootRoute.addChildren([homeRoute, archiveRoute, notesRoute, chatRoute, memexRoute, memexPrintRoute, externalRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
