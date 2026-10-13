// Notes: placeholder page. Replace ModulePage with this component's own UI.

import { createRoute } from "@tanstack/react-router";
import { getModule } from "../../api.ts";
import { ModulePage } from "../../components/ModulePage.tsx";
import { rootRoute } from "../../root.tsx";

export const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  loader: () => getModule("notes"),
  component: function NotesPage() {
    return <ModulePage module={notesRoute.useLoaderData()} />;
  },
});
