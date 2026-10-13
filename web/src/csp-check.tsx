// Used only by scripts/check-csp.ts (through Vite SSR), never by the browser
// bundle: renders one route to HTML with the same MantineProvider flags as
// main.tsx, so the script can look for runtime <style> tags.

import { renderToString } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { theme } from "./theme.ts";
import { routeTree } from "./router.tsx";
import { nav } from "./nav.ts";

export const paths = ["/", ...nav.map((n) => n.to), "/does-not-exist"];

export async function render(path: string): Promise<string> {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderToString(
    <MantineProvider theme={theme} defaultColorScheme="auto" withCssVariables={false} withGlobalClasses={false}>
      <RouterProvider router={router} />
    </MantineProvider>,
  );
}
