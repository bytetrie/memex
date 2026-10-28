// Notes: pages with a block editor, page and tag navigation, links between pages and blocks,
// archive embeds and drawings. Design: ideas/notes.md.

import { notesIndexRoute } from "./index.tsx";
import { notesLayout } from "./layout.tsx";
import { pageRoute } from "./page.tsx";

export const notesRoute = notesLayout.addChildren([notesIndexRoute, pageRoute]);
