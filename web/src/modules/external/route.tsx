// External: placeholder page. Replace ModulePage with this component's own UI.

import { createRoute } from "@tanstack/react-router";
import { getModule } from "../../api.ts";
import { ModulePage } from "../../components/ModulePage.tsx";
import { rootRoute } from "../../root.tsx";

export const externalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/external",
  loader: () => getModule("external"),
  component: function ExternalPage() {
    return <ModulePage module={externalRoute.useLoaderData()} />;
  },
});
