// Stands in for @excalidraw/mermaid-to-excalidraw, which is left out of the install
// (pnpm-workspace.yaml overrides, aliased in vite.config.ts). Excalidraw imports it only when
// someone opens its "Mermaid to Excalidraw" dialog; that dialog then shows this error.

export function parseMermaidToExcalidraw(): Promise<never> {
  return Promise.reject(new Error("Mermaid import is not available in this app."));
}
