// "Draw": a full-screen Excalidraw scratch pad. Insert puts the drawing on the page as an SVG
// (into the selected empty frame, if any); opened on an existing drawing (double-click it, or
// "Edit drawing"), it starts from that drawing's scene and Update replaces it in place.
// lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.

import { Button, Group, Modal, Text } from "@mantine/core";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import { memexAssetUrl } from "../../../../api.ts";
import { useEditorCtx } from "../../canvas/context.ts";
import { insertDrawing } from "../../insert.ts";
import classes from "./Drawing.module.css";

const ScratchPad = lazy(() => {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  return import("./ScratchPad.tsx");
});

const SceneSchema = z.object({ elements: z.array(z.unknown()) });

// What the dialog is open on: nothing yet (a new drawing) or the drawing element `replace`.
export type DrawingTarget = { replace?: string };

export function DrawingDialog({ target, onClose }: { target: DrawingTarget | null; onClose: () => void }): ReactElement {
  const { store, report } = useEditorCtx();
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [scene, setScene] = useState<unknown[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The scene to start from: the edited drawing's, or an empty one.
  useEffect(() => {
    setScene(null);
    setError(null);
    api.current = null;
    if (!target) return;
    const el = target.replace === undefined ? undefined : store.element(target.replace);
    if (el?.kind !== "excalidraw") {
      setScene([]);
      return;
    }
    fetch(memexAssetUrl(el.scene))
      .then(async (res) => {
        if (!res.ok) throw new Error(`The drawing's scene didn't load (HTTP ${String(res.status)}).`);
        setScene(SceneSchema.parse(await res.json()).elements);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [target, store]);

  async function insert() {
    const elements = api.current?.getSceneElements() ?? [];
    if (elements.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await insertDrawing(store, { elements: [...elements] }, target?.replace);
      onClose();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  const editing = target?.replace !== undefined;
  return (
    <Modal opened={target !== null} onClose={onClose} lockScroll={false} fullScreen title={editing ? "Edit the drawing" : "Draw"} classNames={{ body: classes.body }}>
      <Group justify="space-between" gap="xs" mb="xs">
        <Text size="sm" c="dimmed">
          Draw, then {editing ? "update the drawing on the page" : "insert it into the page"}. Text keeps Excalidraw's fonts.
        </Text>
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void insert()} loading={busy} disabled={scene === null}>
            {editing ? "Update the drawing" : "Insert into the page"}
          </Button>
        </Group>
      </Group>
      {error && (
        <Text c="red" size="sm" mb="xs">
          {error}
        </Text>
      )}
      <div className={classes.canvas}>
        {scene !== null && (
          <Suspense fallback={<Text c="dimmed">Loading Excalidraw…</Text>}>
            <ScratchPad elements={scene} onApi={(a) => { api.current = a; }} />
          </Suspense>
        )}
      </div>
    </Modal>
  );
}
