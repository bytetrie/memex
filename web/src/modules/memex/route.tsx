// Memex: placeholder page. Replace ModulePage with this component's own UI.

import { createRoute } from "@tanstack/react-router";
import { getModule } from "../../api.ts";
import { ModulePage } from "../../components/ModulePage.tsx";
import { rootRoute } from "../../root.tsx";

export const memexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memex",
  loader: () => getModule("memex"),
  component: function MemexPage() {
    return <ModulePage module={memexRoute.useLoaderData()} />;
  },
});
