// Vite builds the React app in web/ into static/, which Caddy serves.
//   pnpm build   production build + precompressed .br/.gz copies
//   pnpm dev     rebuild on change (reload https://app.memex to see it)

import { cp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, resolve, sep } from "node:path";
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

// Excalidraw loads its fonts from window.EXCALIDRAW_ASSET_PATH and, as a fallback, from esm.sh.
// Chromium checks every URL of a FontFace against the CSP up front, so the fallback alone logs a
// violation per font even when our copy loads: the build rewrites it to our own path (and fails if
// a new Excalidraw version no longer has it). The fonts are 14 MB, so they are copied out of
// node_modules into static/excalidraw/fonts/ at build time, and served from node_modules by the dev
// server, instead of being committed. The drawing block also sets EXCALIDRAW_ASSET_PATH.
const EXCALIDRAW_FONTS = fileURLToPath(new URL("node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url));
const EXCALIDRAW_FONTS_URL = "/excalidraw/fonts/";

const EXCALIDRAW_FALLBACK = "https://esm.sh/";
const EXCALIDRAW_FALLBACK_END = "/dist/prod/`";

function excalidrawAssets(): Plugin {
  let outDir = "";
  let rewritten = false;
  return {
    name: "excalidraw-assets",
    transform(code, id) {
      if (!id.includes("/@excalidraw/excalidraw/dist/")) return;
      const at = code.indexOf(EXCALIDRAW_FALLBACK);
      if (at === -1) return;
      // The fallback is a template literal: `https://esm.sh/${...}/dist/prod/`
      const start = code.lastIndexOf("`", at);
      const end = code.indexOf(EXCALIDRAW_FALLBACK_END, at);
      if (start !== at - 1 || end === -1 || code.includes(EXCALIDRAW_FALLBACK, end)) {
        this.error("excalidraw-assets: the esm.sh font fallback changed; update vite.config.ts");
      }
      rewritten = true;
      return { code: code.slice(0, start) + "(window.location.origin + \"/excalidraw/\")" + code.slice(end + EXCALIDRAW_FALLBACK_END.length), map: null };
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      if (!rewritten) this.error("excalidraw-assets: Excalidraw's esm.sh font fallback was not found; update vite.config.ts");
      await cp(EXCALIDRAW_FONTS, join(outDir, "excalidraw", "fonts"), { recursive: true });
    },
    configureServer(server) {
      server.middlewares.use(EXCALIDRAW_FONTS_URL, (req, res, next) => {
        const file = normalize(join(EXCALIDRAW_FONTS, decodeURIComponent((req.url ?? "").split("?")[0] ?? "")));
        if (!file.startsWith(EXCALIDRAW_FONTS + sep) || !file.endsWith(".woff2")) {
          next();
          return;
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to EXCALIDRAW_FONTS above
        readFile(file).then(
          (body) => {
            res.setHeader("content-type", "font/woff2");
            res.end(body);
          },
          () => { next(); },
        );
      });
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), mantineStaticCss(), excalidrawAssets()],
  resolve: {
    alias: {
      // Removed from the install (pnpm-workspace.yaml overrides); Excalidraw imports it lazily
      // only for its "Mermaid to Excalidraw" dialog.
      "@excalidraw/mermaid-to-excalidraw": fileURLToPath(new URL("web/src/modules/notes/drawing/mermaid-stub.ts", import.meta.url)),
    },
  },
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
