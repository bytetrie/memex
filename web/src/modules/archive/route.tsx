// Archive: search/browse, add by type, and one entry's page.
// Design: ideas/archive.md. Adding a type: AGENTS.md "Add an archive type".

import { entryRoute } from "./entry.tsx";
import { archiveLayout } from "./layout.tsx";
import { listRoute } from "./list.tsx";
import { newRoute } from "./new.tsx";

export const archiveRoute = archiveLayout.addChildren([listRoute, newRoute, entryRoute]);
