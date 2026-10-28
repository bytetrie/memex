// An Excalidraw drawing in a page: a block atom storing only `drawingId`; the scene is saved on its
// own (PUT /api/notes/drawings/:id), so drawing never re-saves the page.
// Loaded lazily as an island: nothing is fetched until the block is near the viewport, and
// Excalidraw itself (drawing/DrawingCanvas.tsx, a separate chunk) shows a static preview until
// "Edit" mounts the interactive canvas. DrawingBlock is memoised on the id, so the editor
// re-rendering the node view (selection, typing elsewhere) leaves the canvas alone.

import { Alert, Button, Text, useComputedColorScheme } from "@mantine/core";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { NOTE_NODES } from "../../../../../../src/shared/notes-doc.ts";
import type { Drawing as DrawingData, Scene } from "../../../../../../src/shared/notes.ts";
import { getDrawing } from "../../../../api.ts";
import { Icon } from "../../../../icons/Icon.tsx";
import { useNearViewport } from "../../useNearViewport.ts";
import { strAttr } from "../context.ts";
import classes from "../Editor.module.css";
import { insideBody } from "./ArchiveEmbed.tsx";

type CanvasModule = typeof import("../../drawing/DrawingCanvas.tsx");

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

let canvasModule: Promise<CanvasModule> | null = null;
function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    // Our own copy of Excalidraw's fonts (vite.config.ts copies them to static/excalidraw/).
    window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
    canvasModule = import("../../drawing/DrawingCanvas.tsx").catch((err: unknown) => {
      canvasModule = null;
      throw err;
    });
  }
  return canvasModule;
}

function Preview({ mod, scene, dark }: { mod: CanvasModule; scene: Scene; dark: boolean }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void mod.renderPreview(scene, dark).then((canvas) => {
      const el = box.current;
      if (cancelled || !el) return;
      setEmpty(canvas === null);
      if (canvas) {
        canvas.className = classes.drawingPreview ?? "";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Drawing");
        el.replaceChildren(canvas);
      } else {
        el.replaceChildren();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mod, scene, dark]);
  return (
    <>
      <div ref={box} className={classes.drawingPreviewBox} />
      {empty && <Text c="dimmed">An empty drawing. Choose Edit to draw.</Text>}
    </>
  );
}

const DrawingBlock = memo(function DrawingBlock({ drawingId }: { drawingId: string | null }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const dark = useComputedColorScheme("light") === "dark";
  const [state, setState] = useState<{ status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; drawing: DrawingData; mod: CanvasModule }>({
    status: "loading",
  });
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Kept by the editor while it runs; folded into `state` when editing ends.
  const latest = useRef<{ scene?: Scene; version?: number }>({});

  useEffect(() => {
    if (!near || !drawingId) return;
    let cancelled = false;
    Promise.all([getDrawing(drawingId), loadCanvas()]).then(
      ([drawing, mod]) => {
        if (!cancelled) setState(drawing ? { status: "ready", drawing, mod } : { status: "missing" });
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [near, drawingId]);

  const onScene = useCallback((scene: Scene) => {
    latest.current.scene = scene;
  }, []);
  const onSaved = useCallback((version: number) => {
    latest.current.version = version;
  }, []);

  const toggle = () => {
    if (editing && state.status === "ready") {
      const { scene, version } = latest.current;
      setState({ ...state, drawing: { ...state.drawing, scene: scene ?? state.drawing.scene, version: version ?? state.drawing.version } });
    }
    setEditing(!editing);
  };

  return (
    <div ref={ref} className={classes.embed}>
      <div className={classes.embedHead}>
        <Icon name="pencil" />
        <Text span size="sm" fw={500} className={classes.embedTitle}>
          Drawing
        </Text>
        {state.status === "ready" && (
          <Button size="compact-xs" variant={editing ? "filled" : "light"} onClick={toggle} data-embed-body>
            {editing ? "Done" : "Edit"}
          </Button>
        )}
      </div>
      <div className={editing ? classes.drawingCanvas : classes.embedBody} data-embed-body>
        {drawingId === null || state.status === "missing" ? (
          <Text c="dimmed">This drawing no longer exists.</Text>
        ) : state.status === "error" ? (
          <Text c="red">The drawing didn't load: {state.message}</Text>
        ) : state.status === "loading" ? (
          <Text c="dimmed">Loading…</Text>
        ) : editing ? (
          <state.mod.DrawingEditor drawing={state.drawing} dark={dark} onScene={onScene} onSaved={onSaved} onError={setSaveError} />
        ) : (
          <Preview mod={state.mod} scene={state.drawing.scene} dark={dark} />
        )}
      </div>
      {saveError && (
        <Alert color="red" title="The drawing isn't saved">
          {saveError}
        </Alert>
      )}
    </div>
  );
});

function DrawingView({ node, selected }: ReactNodeViewProps): ReactElement {
  return (
    <NodeViewWrapper className={classes.atomBlock} data-selected={selected ? "" : undefined}>
      <DrawingBlock drawingId={strAttr(node, "drawingId")} />
    </NodeViewWrapper>
  );
}

export const Drawing = Node.create({
  name: NOTE_NODES.drawing,
  group: "block",
  atom: true,
  // Not natively draggable: holding the mouse down inside (drawing, scrubbing a video) must not
  // drag the block. It moves with the editor's drag handle like any block.
  draggable: false,
  selectable: true,
  addAttributes() {
    return {
      drawingId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing-id"), renderHTML: (a: Record<string, unknown>) => ({ "data-drawing-id": a.drawingId }) },
    };
  },
  parseHTML() {
    return [{ tag: `div[data-type="${NOTE_NODES.drawing}"]` }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": NOTE_NODES.drawing })];
  },
  renderText() {
    return "[drawing]";
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, { stopEvent: ({ event }) => insideBody(event) });
  },
});
