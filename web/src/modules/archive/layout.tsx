// /archive is a layout: the list, the add forms and the entry page render
// inside it (route.tsx lists them).

import { Outlet, createRoute } from "@tanstack/react-router";
import { rootRoute } from "../../root.tsx";

export const archiveLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: "/archive",
  component: Outlet,
});
