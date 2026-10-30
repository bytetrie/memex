/// <reference types="vite/client" />

// Served by the mantine-static-css plugin in vite.config.ts.
declare module "virtual:mantine-static.css";

// Excalidraw's font subsets per family, from the excalidraw-fonts plugin in vite.config.ts.
declare module "virtual:excalidraw-fonts" {
  const fonts: Record<string, { file: string; unicodeRange?: string }[]>;
  export default fonts;
}
