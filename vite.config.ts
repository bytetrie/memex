// Vite builds the React app in web/ into static/, which Caddy serves.
//   pnpm build   production build + precompressed .br/.gz copies
//   pnpm dev     rebuild on change (reload https://app.memex to see it)

import { cp, readdir, readFile } from "node:fs/promises";
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

// Excalidraw's font subsets (file and unicode range per family), for embedding fonts in the SVG
// of a memex drawing (web/src/modules/memex/kinds/excalidraw/render.ts): Excalidraw's own SVG
// export would subset them with WebAssembly started through `new Function`, which the CSP refuses.
// Read from its readable build at build time:
//   import fonts from "virtual:excalidraw-fonts";  // { [family]: { file, unicodeRange? }[] }
const EXCALIDRAW_DEV_DIST = fileURLToPath(new URL("node_modules/@excalidraw/excalidraw/dist/dev", import.meta.url));

async function excalidrawFontManifest(): Promise<Record<string, { file: string; unicodeRange?: string }[]>> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed folder in node_modules
  for (const name of await readdir(EXCALIDRAW_DEV_DIST)) {
    if (!name.endsWith(".js")) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file listed in Excalidraw's own dist folder
    const code = await readFile(join(EXCALIDRAW_DEV_DIST, name), "utf8");
    if (!code.includes("ExcalifontFontFaces = [")) continue;
    // String constants (family names, shared unicode ranges): `var NAME = "..."` and `KEY: "..."`.
    const strings = new Map([...code.matchAll(/var (\w+) = "([^"]*)";/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
    const ranges = new Map([...(/var GOOGLE_FONTS_RANGES = \{([\s\S]*?)\};/.exec(code)?.[1] ?? "").matchAll(/(\w+): "([^"]+)"/g)].map((m) => [`GOOGLE_FONTS_RANGES.${m[1] ?? ""}`, m[2] ?? ""]));
    const value = (token: string | undefined) => (token === undefined ? undefined : token.startsWith('"') ? token.slice(1, -1) : (strings.get(token) ?? ranges.get(token)));
    const lists = new Map<string, { file: string; unicodeRange?: string }[]>();
    for (const m of code.matchAll(/var (\w+FontFaces) = \[([\s\S]*?)\n\];/g)) {
      // One face per `uri:` entry; its unicodeRange, if any, comes before the next entry.
      const faces = (m[2] ?? "").split("uri: ").slice(1).flatMap((entry) => {
        const file = strings.get(/^\w+/.exec(entry)?.[0] ?? "");
        if (!file?.startsWith("./fonts/") || !file.endsWith(".woff2")) return [];
        const unicodeRange = value(/unicodeRange: ("[^"]+"|[\w.]+)/.exec(entry)?.[1]);
        return [{ file: file.slice("./fonts/".length), ...(unicodeRange ? { unicodeRange } : {}) }];
      });
      lists.set(m[1] ?? "", faces);
    }
    const manifest = new Map<string, { file: string; unicodeRange?: string }[]>();
    for (const m of code.matchAll(/init\(("[^"]+"|\w+), \.\.\.(\w+FontFaces)\)/g)) {
      const family = value(m[1]);
      const faces = lists.get(m[2] ?? "");
      if (family && faces?.length) manifest.set(family, faces);
    }
    if (!manifest.get("Excalifont")?.length || !manifest.get("Virgil")?.length) break;
    return Object.fromEntries(manifest);
  }
  throw new Error("excalidraw-fonts: Excalidraw's font list was not found in its dist; update vite.config.ts");
}

function excalidrawFonts(): Plugin {
  const id = "virtual:excalidraw-fonts";
  const resolved = `\0${id}`;
  return {
    name: "excalidraw-fonts",
    resolveId: (source) => (source === id ? resolved : undefined),
    async load(loaded) {
      if (loaded !== resolved) return;
      return `export default ${JSON.stringify(await excalidrawFontManifest())};`;
    },
  };
}

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
  plugins: [react(), mantineStaticCss(), excalidrawAssets(), excalidrawFonts()],
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          // zod checks whether it may use `new Function` when a schema is created, unless jitless
          // mode is on (web/src/zod-config.ts; the CSP refuses eval). Schemas in a shared chunk
          // would be created before the config in the entry chunk runs, so the config goes into
          // zod's own chunk, which runs before anything that makes a schema.
          groups: [{ name: "zod", test: /\/node_modules\/zod\/|\/web\/src\/zod-config\.ts$/ }],
        },
      },
    },
  },
  server: {
    hmr: {
      clientPort: 443
    }
  },
});
