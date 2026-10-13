// Vite builds the React app in web/ into static/, which Caddy serves.
//   pnpm build   production build + precompressed .br/.gz copies
//   pnpm dev     rebuild on change (reload https://app.memex to see it)

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { theme } from "./web/src/theme.ts";

// The CSP has no 'unsafe-inline' for styles, so MantineProvider must not inject
// <style> tags at runtime (web/src/main.tsx turns them off). This plugin renders
// the provider once at build time and serves the same CSS as a static file:
//   import "virtual:mantine-static.css";
// Theme edits need a restart of `pnpm dev` / `pnpm dev:hmr`.
function mantineStaticCss(): Plugin {
  const id = "virtual:mantine-static.css";
  const resolved = `\0${id}`;
  return {
    name: "mantine-static-css",
    resolveId: (source) => (source === id ? resolved : undefined),
    load(loaded) {
      if (loaded !== resolved) return;
      const html = renderToStaticMarkup(createElement(MantineProvider, { theme }, null));
      const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
      if (!css.includes("--mantine-")) throw new Error("mantine-static-css: no CSS variables rendered");
      return css;
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), mantineStaticCss()],
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    hmr: {
      clientPort: 443
    }
  },
});
