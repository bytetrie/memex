// What the editor screen hands to the canvas, the inspector and the layers panel.

import { createContext, useContext } from "react";
import type { DocStore } from "../doc/store.ts";

// A canvas tool that takes over the pointer: "frame" draws an empty frame (Add image).
export type Tool = "frame" | null;

export type EditorContext = {
  store: DocStore;
  // Where an open text box puts its formatting toolbar.
  toolbar: HTMLElement | null;
  // Shows an error from an action that runs in the background (an upload, a paste).
  report: (err: unknown) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  // Opens the file picker; the chosen images fill the selected frame, if one is selected.
  chooseImage: () => void;
  // Opens the Excalidraw scratch pad, on the drawing `id` when given (to edit it).
  openDrawing: (id?: string) => void;
  // Opens the QR code dialog (fills the selected frame, if one is selected).
  openQr: () => void;
};

export const EditorCtx = createContext<EditorContext | null>(null);

export function useEditorCtx(): EditorContext {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error("useEditorCtx outside the memex editor");
  return ctx;
}
