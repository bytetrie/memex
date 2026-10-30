// /memex/p/$pageId: the editor for one page. Title and tags on top, a toolbar, the canvas
// (canvas/PageCanvas.tsx) and, on the right, the inspector over the layers.
//
// The doc lives in an external store (doc/store.ts) that the autosave reads when it saves; the
// page's data is fetched fresh whenever it is opened (gcTime 0): an editor started from a stale
// doc would conflict on its first save. Keyboard: Ctrl+Z / Ctrl+Shift+Z undo and redo, Delete,
// Ctrl+D duplicate, arrows nudge (Shift: 10 pt), Ctrl+] / Ctrl+[ a layer up or down (with Shift:
// to the top or bottom), Ctrl+A selects everything, Escape ends editing or selection.

import { ActionIcon, Alert, Button, Group, NativeSelect, TagsInput, Text, TextInput, Tooltip } from "@mantine/core";
import { createRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import { pageDimensions, type PageDoc } from "../../../../src/shared/memex-doc.ts";
import type { MemexPage } from "../../../../src/shared/memex.ts";
import { getMemexPage, saveMemexPage, setMemexPageTags } from "../../api.ts";
import { createAutosave } from "../../autosave.ts";
import { SaveStatus } from "../../components/SaveStatus.tsx";
import { Icon } from "../../icons/Icon.tsx";
import { EditorCtx, useEditorCtx, type EditorContext, type Tool } from "./canvas/context.ts";
import { PageCanvas } from "./canvas/PageCanvas.tsx";
import { duplicateElements, removeElements, reorderElements, updateElements, type Reorder } from "./doc/commands.ts";
import { createDocStore, useStore, type DocStore } from "./doc/store.ts";
import { memexPagesChanged } from "./events.ts";
import { insertData, insertTextBox } from "./insert.ts";
import { Inspector } from "./Inspector.tsx";
import { DrawingDialog, type DrawingTarget } from "./kinds/excalidraw/DrawingDialog.tsx";
import { QrDialog } from "./kinds/qr/QrDialog.tsx";
import { LayersPanel } from "./LayersPanel.tsx";
import { memexLayout } from "./layout.tsx";
import classes from "./Memex.module.css";
import { PX_PER_PT } from "./render/units.ts";

const ZOOMS = [
  { value: "fit", label: "Fit" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
];
// The canvas area's padding on each side (Canvas.module.css .area).
const AREA_PADDING_PX = 40;
const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,.svg";

export const memexPageRoute = createRoute({
  getParentRoute: () => memexLayout,
  path: "p/$pageId",
  params: {
    parse: (raw) => {
      const pageId = z.uuid().safeParse(raw.pageId);
      if (!pageId.success) throw notFound();
      return { pageId: pageId.data };
    },
  },
  gcTime: 0,
  staleTime: 0,
  loader: async ({ params }) => {
    const page = await getMemexPage(params.pageId);
    if (!page) throw notFound();
    return page;
  },
  component: function MemexPageRoute(): ReactElement {
    const page = memexPageRoute.useLoaderData();
    // Bumped to start over from the server's version after a conflict.
    const [generation, setGeneration] = useState(0);
    return <PageEditor key={`${page.id}:${String(generation)}`} page={page} onReload={() => { setGeneration((g) => g + 1); }} />;
  },
});

// Fields, open text boxes and dialogs (the scratch pad, the QR dialog) keep their own keys and pastes.
const editableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest('[role="dialog"]') !== null);

// The editor's keyboard shortcuts, on the window while the editor is open.
function useShortcuts(store: DocStore, tool: { current: Tool }, setTool: (t: Tool) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editableTarget(e.target) || e.defaultPrevented) return;
      if (e.key === "Escape" && tool.current) {
        e.preventDefault();
        setTool(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const { selection, editing } = store.getState();
      const doc = store.getDoc();
      const key = e.key.toLowerCase();
      const step = e.shiftKey ? 10 : 1;
      const nudge = new Map([["ArrowLeft", [-step, 0]], ["ArrowRight", [step, 0]], ["ArrowUp", [0, -step]], ["ArrowDown", [0, step]]]).get(e.key);
      const bracket = e.key === "]" || e.key === "[" || e.code === "BracketRight" || e.code === "BracketLeft";
      if (mod && key === "z") {
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === "y") {
        store.redo();
      } else if (mod && key === "a") {
        store.select(doc.elements.filter((el) => !el.hidden && !el.locked).map((el) => el.id));
      } else if (e.key === "Escape") {
        if (editing) store.edit(null);
        else store.select([]);
      } else if (selection.length === 0) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        store.commit(removeElements(doc, selection));
      } else if (mod && key === "d") {
        const d = duplicateElements(doc, selection);
        store.commit(d.doc, { select: d.ids });
      } else if (mod && bracket) {
        const up = e.key === "]" || e.code === "BracketRight";
        const how: Reorder = up ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward";
        store.commit(reorderElements(doc, selection, how));
      } else if (nudge) {
        const [dx = 0, dy = 0] = nudge;
        const movable = doc.elements.filter((el) => selection.includes(el.id) && !el.locked).map((el) => el.id);
        store.commit(updateElements(doc, movable, (el) => ({ x: el.x + dx, y: el.y + dy })), { merge: "nudge" });
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [store, tool, setTool]);
}

// Pasting onto the page (not into a field or an open text box).
function usePaste(store: DocStore, report: (err: unknown) => void) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editableTarget(e.target) || !e.clipboardData) return;
      const files = [...e.clipboardData.files];
      const text = e.clipboardData.getData("text/plain");
      if (files.length === 0 && !text) return;
      e.preventDefault();
      // A selected empty frame takes it (insert.ts).
      insertData(store, { files, text }).catch(report);
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [store, report]);
}

// The zoom that fits the page's width into the canvas area.
function useFitZoom(store: DocStore) {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const format = useStore(store, (s) => s.doc.format);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  const page = pageDimensions(format);
  const fit = width > 0 ? Math.min(2, Math.max(0.2, (width - AREA_PADDING_PX) / (page.w * PX_PER_PT))) : 1;
  return { area, fit };
}

function Toolbar({ zoom, setZoom, onPrint, toolbarSlot }: { zoom: string; setZoom: (z: string) => void; onPrint: () => void; toolbarSlot: (el: HTMLDivElement | null) => void }): ReactElement {
  const { store, tool, setTool, openDrawing, openQr } = useEditorCtx();
  const canUndo = useStore(store, (s) => s.canUndo);
  const canRedo = useStore(store, (s) => s.canRedo);
  const editing = useStore(store, (s) => s.editing !== null);
  return (
    <div className={classes.toolbar} role="toolbar" aria-label="Page tools">
      <Group gap="xs" wrap="wrap">
        <Button size="xs" variant="light" leftSection={<Icon name="font" />} onClick={() => { const id = insertTextBox(store); store.edit(id); }}>
          Add text
        </Button>
        <Button size="xs" variant={tool === "frame" ? "filled" : "light"} leftSection={<Icon name="picture" />} aria-pressed={tool === "frame"} onClick={() => { setTool(tool === "frame" ? null : "frame"); }}>
          Add image
        </Button>
        <Button size="xs" variant="light" leftSection={<Icon name="brush" />} onClick={() => { openDrawing(); }}>
          Draw
        </Button>
        <Button size="xs" variant="light" leftSection={<Icon name="qrcode" />} onClick={openQr}>
          QR code
        </Button>
        <Tooltip label="Undo (Ctrl+Z)">
          <ActionIcon variant="default" aria-label="Undo" disabled={!canUndo} onClick={() => { store.undo(); }}>
            <Icon name="ccw" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Redo (Ctrl+Shift+Z)">
          <ActionIcon variant="default" aria-label="Redo" disabled={!canRedo} onClick={() => { store.redo(); }}>
            <Icon name="cw" />
          </ActionIcon>
        </Tooltip>
        <NativeSelect size="xs" aria-label="Zoom" data={ZOOMS} value={zoom} onChange={(e) => { setZoom(e.currentTarget.value); }} w={84} />
        <Button size="xs" variant="default" leftSection={<Icon name="print" />} onClick={onPrint}>
          Print this page
        </Button>
      </Group>
      {tool === "frame" && (
        <Text size="sm" c="blue" aria-live="polite">
          Drag on the page where the image goes, then drop, paste or choose it. Esc cancels.
        </Text>
      )}
      <div ref={toolbarSlot} className={classes.textToolbar} hidden={!editing} />
    </div>
  );
}

function PageEditor({ page, onReload }: { page: MemexPage; onReload: () => void }): ReactElement {
  const router = useRouter();
  const navigate = useNavigate();
  const autosave = useMemo(
    () => createAutosave<PageDoc>({ version: page.version, title: page.title, save: (input, opts) => saveMemexPage(page.id, input, opts), onSaved: memexPagesChanged }),
    [], // one per page view: the key in MemexPageRoute replaces this component for another page
  );
  const store = useMemo(() => createDocStore(page.doc, () => { autosave.markDirty(); }), []);
  const [title, setTitle] = useState(page.title);
  const [tags, setTags] = useState(page.tags);
  const [tagError, setTagError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [zoomChoice, setZoomChoice] = useState("fit");
  const { area, fit } = useFitZoom(store);
  const zoom = zoomChoice === "fit" ? fit : Number(zoomChoice);

  const [tool, setToolState] = useState<Tool>(null);
  const toolRef = useRef<Tool>(null);
  const setTool = useCallback((next: Tool) => {
    toolRef.current = next;
    setToolState(next);
  }, []);
  const [drawing, setDrawing] = useState<DrawingTarget | null>(null);
  const [qr, setQr] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const report = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);
  const ctx = useMemo<EditorContext>(
    () => ({
      store,
      toolbar: slot,
      report,
      tool,
      setTool,
      chooseImage: () => fileInput.current?.click(),
      openDrawing: (id?: string) => {
        store.edit(null);
        setDrawing(id === undefined ? {} : { replace: id });
      },
      openQr: () => {
        setQr(true);
      },
    }),
    [store, slot, report, tool, setTool],
  );

  useEffect(() => autosave.attach(() => store.getDoc()), [autosave, store]);
  useShortcuts(store, toolRef, setTool);
  usePaste(store, report);

  async function changeTags(next: string[]) {
    setTags(next);
    try {
      const saved = await setMemexPageTags(page.id, next);
      setTags(saved.tags);
      setTagError(null);
      memexPagesChanged();
    } catch (err) {
      setTagError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reload() {
    await router.invalidate({ filter: (m) => m.routeId === memexPageRoute.id });
    onReload();
  }

  async function print() {
    store.edit(null);
    await autosave.flush();
    await navigate({ to: "/memex/print", search: { pages: page.id, layout: "single" } });
  }

  return (
    <EditorCtx.Provider value={ctx}>
      <article className={classes.editor} aria-labelledby="memex-page-title">
        <div className={classes.head}>
          <TextInput
            id="memex-page-title"
            className={classes.title}
            variant="unstyled"
            aria-label="Page title"
            placeholder="Untitled"
            value={title}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setTitle(next);
              autosave.setTitle(next);
            }}
          />
          <SaveStatus autosave={autosave} onReload={reload} />
        </div>
        <TagsInput
          label="Tags"
          placeholder="Add a tag"
          value={tags}
          onChange={(next) => void changeTags(next.map((t) => t.trim().toLowerCase()).filter(Boolean))}
          error={tagError}
          size="xs"
          leftSection={<Icon name="tag" />}
        />
        <Toolbar zoom={zoomChoice} setZoom={setZoomChoice} onPrint={() => void print()} toolbarSlot={setSlot} />
        {/* The file picker behind chooseImage: the images fill the selected frame, if any. */}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={IMAGE_TYPES}
          hidden
          aria-label="Image file"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            if (files.length) insertData(store, { files, text: "" }).catch(report);
          }}
        />
        <DrawingDialog target={drawing} onClose={() => { setDrawing(null); }} />
        <QrDialog opened={qr} onClose={() => { setQr(false); }} />
        {error && (
          <Alert color="red" title="That didn't work" withCloseButton closeButtonLabel="Dismiss" onClose={() => { setError(null); }}>
            <Text size="sm">{error}</Text>
          </Alert>
        )}
        <div className={classes.workspace}>
          <div ref={area} className={classes.canvasColumn}>
            <PageCanvas zoom={zoom} />
          </div>
          <div className={classes.side}>
            <Inspector />
            <LayersPanel />
          </div>
        </div>
      </article>
    </EditorCtx.Provider>
  );
}
