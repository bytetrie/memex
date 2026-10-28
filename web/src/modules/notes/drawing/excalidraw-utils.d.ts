// Excalidraw 0.18's types re-export its image export functions from "@excalidraw/utils/export", a
// module its package doesn't resolve (the file ships as dist/types/utils/export.d.ts), so they come
// out untyped. This declares the one DrawingCanvas.tsx uses, copied from that file; re-check it when
// upgrading Excalidraw.
declare module "@excalidraw/utils/export" {
  import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
  import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

  export const exportToCanvas: (opts: {
    elements: readonly NonDeleted<ExcalidrawElement>[];
    appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;
    files: BinaryFiles | null;
    maxWidthOrHeight?: number;
    exportPadding?: number;
  }) => Promise<HTMLCanvasElement>;
}
