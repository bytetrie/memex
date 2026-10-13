import "./zod-config.ts";
import "@mantine/core/styles.css";
import "virtual:mantine-static.css";
import "./fonts.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { RouterProvider } from "@tanstack/react-router";
import { theme } from "./theme.ts";
import { router } from "./router.tsx";

// Surface CSP violations (e.g. a Mantine component injecting <style>) instead
// of letting them fail silently. See AGENTS.md "CSP rules".
document.addEventListener("securitypolicyviolation", (e) => {
  console.error(`CSP blocked ${e.effectiveDirective}: ${e.blockedURI || "inline"}`, e.target);
});

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(
  <StrictMode>
    {/* Runtime <style> injection is off; vite.config.ts serves the same CSS statically. */}
    <MantineProvider theme={theme} defaultColorScheme="auto" withCssVariables={false} withGlobalClasses={false}>
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
