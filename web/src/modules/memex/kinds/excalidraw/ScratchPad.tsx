// The Excalidraw scratch pad's canvas, loaded with import() so Excalidraw stays its own chunk
// (shared with notes' drawings). The dialog around it (DrawingDialog.tsx) reads the drawing
// through the API handed to onApi when it inserts it.
//
// As in notes, Excalidraw's export, open and save actions and its image tool are hidden: the
// drawing is saved into the page, and images belong on the page itself.

import "@excalidraw/excalidraw/index.css";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, UIOptions } from "@excalidraw/excalidraw/types";
import { useMemo, type ReactElement } from "react";
import { restore } from "./render.ts";

const UI: UIOptions = {
  canvasActions: { export: false, saveAsImage: false, loadScene: false, saveToActiveFile: false, toggleTheme: null },
  tools: { image: false },
};

export default function ScratchPad({ elements, onApi }: { elements: unknown[]; onApi: (api: ExcalidrawImperativeAPI) => void }): ReactElement {
  const initialData = useMemo<ExcalidrawInitialDataState>(
    () => ({ elements: restore(elements), appState: { viewBackgroundColor: "#ffffff" }, scrollToContent: true }),
    [], // Excalidraw reads its initial data once
  );
  return <Excalidraw initialData={initialData} theme="light" UIOptions={UI} excalidrawAPI={onApi} />;
}
