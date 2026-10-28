// Everything that needs Excalidraw, loaded only through import() (DrawingBlock in
// editor/nodes/Drawing.tsx), so Excalidraw and its CSS are a separate chunk.
//
// - DrawingEditor: the interactive canvas, mounted only while a drawing is being edited. onChange
//   fires on every pointer move, so it never sets React state: it compares the elements' version
//   hash and saves a second after the last real change (and on unmount).
// - renderPreview: a static <canvas> of the scene, shown when not editing. exportToCanvas needs no
//   WebAssembly and sets no inline styles, unlike SVG export (which the CSP blocks: ideas/notes.md).
//
// Excalidraw's export, open and save-to-file actions and its image tool are hidden: scenes are
// saved for you, and images would bloat them (the server keeps no files for notes).

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToCanvas, hashElementsVersion, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawInitialDataState, UIOptions } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import type { Drawing, Scene } from "../../../../../src/shared/notes.ts";
import { saveDrawing, VersionConflictError } from "../../../api.ts";

const SAVE_DELAY_MS = 1000;

const UI: UIOptions = {
  canvasActions: { export: false, saveAsImage: false, loadScene: false, saveToActiveFile: false, toggleTheme: null },
  tools: { image: false },
};

function elementsOf(scene: Scene): OrderedExcalidrawElement[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- restoreElements repairs whatever element data it is given
  return restoreElements(scene.elements as unknown as ExcalidrawElement[], null);
}

const toScene = (elements: readonly OrderedExcalidrawElement[], appState: Pick<AppState, "viewBackgroundColor">): Scene => ({
  elements: elements.filter((e) => !e.isDeleted).map((e) => ({ ...e })),
  appState: { viewBackgroundColor: appState.viewBackgroundColor },
});

// After a failed save: keep its scene for the next try, unless a newer change already replaced it.
function keepPending(pending: { current: Scene | null }, scene: Scene) {
  if (!pending.current) pending.current = scene;
}

const background = (scene: Scene) => {
  const bg = scene.appState?.viewBackgroundColor;
  return typeof bg === "string" ? bg : "#ffffff";
};

export function renderPreview(scene: Scene, dark: boolean): Promise<HTMLCanvasElement | null> {
  const elements = elementsOf(scene);
  if (elements.length === 0) return Promise.resolve(null);
  return exportToCanvas({
    elements,
    appState: { exportBackground: true, viewBackgroundColor: background(scene), exportWithDarkMode: dark },
    files: null,
    exportPadding: 16,
  });
}

export type DrawingEditorProps = {
  drawing: Drawing;
  dark: boolean;
  // Latest scene and saved version, kept by the block for its preview (not React state: no re-render).
  onScene: (scene: Scene) => void;
  onSaved: (version: number) => void;
  onError: (message: string | null) => void;
};

export function DrawingEditor({ drawing, dark, onScene, onSaved, onError }: DrawingEditorProps): ReactElement {
  const initialData = useMemo<ExcalidrawInitialDataState>(
    () => ({ elements: elementsOf(drawing.scene), appState: { viewBackgroundColor: background(drawing.scene) }, scrollToContent: true }),
    [], // Excalidraw reads its initial data once
  );
  const version = useRef(drawing.version);
  const lastHash = useRef<number | null>(null);
  const pending = useRef<Scene | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(async () => {
    const scene = pending.current;
    if (!scene) return;
    pending.current = null;
    try {
      const saved = await saveDrawing(drawing.id, { scene, baseVersion: version.current });
      version.current = saved.version;
      onSaved(saved.version);
      onError(null);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        // Saved in another tab: the canvas open here wins, it is what the person is looking at.
        version.current = err.version;
        keepPending(pending, scene);
        await save();
        return;
      }
      keepPending(pending, scene);
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [drawing.id, onSaved, onError]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      const hash = hashElementsVersion(elements);
      if (lastHash.current === null) {
        lastHash.current = hash; // the first call reports the initial scene
        return;
      }
      if (hash === lastHash.current) return;
      lastHash.current = hash;
      const scene = toScene(elements, appState);
      pending.current = scene;
      onScene(scene);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [onScene, save],
  );

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void save();
    },
    [save],
  );

  return <Excalidraw initialData={initialData} theme={dark ? "dark" : "light"} onChange={onChange} UIOptions={UI} />;
}
