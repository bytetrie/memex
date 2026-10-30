// "/": the app opens on the notes (which open the page last viewed, modules/notes/lastPage.ts).

import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "../root.tsx";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/notes", replace: true });
  },
});
