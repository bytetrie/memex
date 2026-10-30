// The page being edited, at a zoom: the paper with its margin guide and grid, one ElementView per
// element (memoised on its id: a drag re-renders only what moves, store.ts), and an overlay with
// the selection, its resize handles and the snap guides. Plain DOM and pointer events.
//
// - Click selects (Shift adds or removes); drag moves the selection, snapping (Alt: no snapping);
//   the handles resize one element (Shift keeps its proportions). A drag shows as a preview and
//   becomes one undo step when the pointer is released.
// - Double-click (or Enter) on a text box edits it in place; Escape or a click elsewhere ends it.
// - Files and text dropped onto the page are added where they land, or fill the empty frame they
//   land on (insert.ts). Double-click: edits a text box, picks a file for a frame, reopens a
//   drawing in the scratch pad.
// - With the frame tool (Add image), dragging draws an empty frame, snapping like a resize.

import { lazy, memo, Suspense, useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from "react";
import { pageDimensions, type PageElement, type TextElement } from "../../../../../src/shared/memex-doc.ts";
import type { DocNode } from "../../../../../src/shared/notes-doc.ts";
import { updateElements } from "../doc/commands.ts";
import { useElement, useStore, type DocStore } from "../doc/store.ts";
import { insertData, insertFrame, type Point } from "../insert.ts";
import { ElementBody, labelOf } from "../kinds/index.tsx";
import { frameStyle, PAGE_FONT, pt, PX_PER_PT } from "../render/units.ts";
import classes from "./Canvas.module.css";
import { useEditorCtx, type Tool } from "./context.ts";
import { boundsOf, resizeBox, snapMove, snapResize, snapTargets, type Box, type Edges, type Guides, type Targets } from "./snap.ts";

const TextBoxEditor = lazy(() => import("../kinds/text/TextBoxEditor.tsx"));

// Screen pixels within which things snap, and a pointer must travel before a click becomes a drag.
const SNAP_PX = 6;
const DRAG_PX = 3;
const HANDLE_PX = 9;

type Gesture =
  | { type: "move"; start: Point; origins: Map<string, Point>; bounds: Box; targets: Targets; moved: boolean }
  | { type: "resize"; id: string; start: Point; box: Box; edges: Edges; targets: Targets; moved: boolean };

const HANDLES: { edges: Edges; name: string }[] = [
  { edges: { top: true, left: true }, name: "nw" },
  { edges: { top: true }, name: "n" },
  { edges: { top: true, right: true }, name: "ne" },
  { edges: { right: true }, name: "e" },
  { edges: { bottom: true, right: true }, name: "se" },
  { edges: { bottom: true }, name: "s" },
  { edges: { bottom: true, left: true }, name: "sw" },
  { edges: { left: true }, name: "w" },
];

const boxOf = (e: PageElement): Box => ({ x: e.x, y: e.y, w: e.w, h: e.h });

// The pointer handling, shared by elements and handles through `begin*`.
function useGestures(store: DocStore, page: RefObject<HTMLDivElement | null>, zoom: number) {
  const gesture = useRef<Gesture | null>(null);

  const toPt = useCallback(
    (clientX: number, clientY: number): Point => {
      const el = page.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const { w, h } = pageDimensions(store.getDoc().format);
      return { x: ((clientX - r.left) / r.width) * w, y: ((clientY - r.top) / r.height) * h };
    },
    [page, store],
  );

  const ptPerPx = 1 / (PX_PER_PT * zoom);

  const track = useCallback(
    (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
      const move = (e: PointerEvent) => {
        onMove(e);
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        onUp(e);
        gesture.current = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [],
  );

  const targetsWithout = (ids: Set<string>): Targets => {
    const doc = store.getDoc();
    return snapTargets(doc.format, doc.grid, doc.elements.filter((e) => !ids.has(e.id) && !e.hidden).map(boxOf));
  };

  const beginMove = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = store.getState();
    if (state.editing && state.editing !== id) store.edit(null);
    let selection = state.selection;
    if (e.shiftKey) selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
    else if (!selection.includes(id)) selection = [id];
    store.select(selection);
    const moving = store.getDoc().elements.filter((el) => selection.includes(el.id) && !el.locked);
    const bounds = boundsOf(moving.map(boxOf));
    if (!bounds) return;
    const g: Gesture = {
      type: "move",
      start: toPt(e.clientX, e.clientY),
      origins: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
      bounds,
      targets: targetsWithout(new Set(moving.map((el) => el.id))),
      moved: false,
    };
    gesture.current = g;
    track(
      (ev) => {
        const p = toPt(ev.clientX, ev.clientY);
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < DRAG_PX * ptPerPx) return;
        g.moved = true;
        let guides: Guides = { xs: [], ys: [] };
        if (!ev.altKey) ({ dx, dy, guides } = snapMove(g.bounds, dx, dy, g.targets, SNAP_PX * ptPerPx));
        store.preview(new Map([...g.origins].map(([oid, o]) => [oid, { x: o.x + dx, y: o.y + dy }])), guides);
      },
      () => {
        const changes = store.getState().preview?.elements;
        if (!g.moved || !changes) {
          store.preview(null);
          return;
        }
        store.commit(updateElements(store.getDoc(), [...changes.keys()], (el) => changes.get(el.id) ?? {}));
      },
    );
  };

  const beginResize = (e: ReactPointerEvent, el: PageElement, edges: Edges) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const g: Gesture = { type: "resize", id: el.id, start: toPt(e.clientX, e.clientY), box: boxOf(el), edges, targets: targetsWithout(new Set([el.id])), moved: false };
    gesture.current = g;
    track(
      (ev) => {
        const p = toPt(ev.clientX, ev.clientY);
        g.moved = true;
        let box = resizeBox(g.box, g.edges, p.x - g.start.x, p.y - g.start.y, ev.shiftKey);
        let guides: Guides = { xs: [], ys: [] };
        if (!ev.altKey && !ev.shiftKey) ({ box, guides } = snapResize(box, g.edges, g.targets, SNAP_PX * ptPerPx));
        store.preview(new Map([[g.id, box]]), guides);
      },
      () => {
        const change = store.getState().preview?.elements.get(g.id);
        if (!g.moved || !change) {
          store.preview(null);
          return;
        }
        store.commit(updateElements(store.getDoc(), [g.id], change));
      },
    );
  };

  return { toPt, beginMove, beginResize };
}

type Gestures = ReturnType<typeof useGestures>;

const TextEditing = memo(function TextEditing({ el }: { el: TextElement }): ReactElement {
  const { store, toolbar } = useEditorCtx();
  const onChange = useCallback(
    (content: DocNode, height: number) => {
      store.commit(
        updateElements(store.getDoc(), [el.id], (e) => ({ content, h: Math.max(e.h, Math.ceil(height)) })),
        { merge: `text:${el.id}` },
      );
    },
    [store, el.id],
  );
  const onExit = useCallback(() => {
    store.edit(null);
  }, [store]);
  return (
    <Suspense fallback={<ElementBody el={el} />}>
      <TextBoxEditor el={el} toolbar={toolbar} onChange={onChange} onExit={onExit} />
    </Suspense>
  );
});

const ElementView = memo(function ElementView({ id, gestures }: { id: string; gestures: Gestures }): ReactElement | null {
  const { store, chooseImage, openDrawing } = useEditorCtx();
  const el = useElement(store, id);
  const selected = useStore(store, (s) => s.selection.includes(id));
  const editing = useStore(store, (s) => s.editing === id);
  if (!el || el.hidden) return null;
  const label = labelOf(el);
  return (
    <div
      className={classes.element}
      style={frameStyle(el)}
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      aria-label={editing ? undefined : label}
      aria-pressed={editing ? undefined : selected}
      data-locked={el.locked ? "" : undefined}
      data-editing={editing ? "" : undefined}
      onPointerDown={editing ? undefined : (e) => { gestures.beginMove(e, id); }}
      onDoubleClick={() => {
        if (el.locked) return;
        if (el.kind === "text") store.edit(id);
        else if (el.kind === "frame") {
          store.select([id]);
          chooseImage();
        } else if (el.kind === "excalidraw") openDrawing(id);
      }}
      onKeyDown={(e) => {
        if (editing || e.target !== e.currentTarget) return;
        if (e.key === "Enter" && el.kind === "text" && !el.locked) {
          e.preventDefault();
          store.edit(id);
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          store.select(e.shiftKey ? [...store.getState().selection, id] : [id]);
        }
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !store.getState().selection.includes(id)) store.select([id]);
      }}
    >
      {editing && el.kind === "text" ? <TextEditing el={el} /> : <ElementBody el={el} />}
    </div>
  );
});

function SelectedBox({ id, zoom, single, gestures }: { id: string; zoom: number; single: boolean; gestures: Gestures }): ReactElement | null {
  const { store } = useEditorCtx();
  const el = useElement(store, id);
  if (!el || el.hidden) return null;
  const handle = HANDLE_PX / (PX_PER_PT * zoom);
  return (
    <div className={classes.selected} style={{ left: pt(el.x), top: pt(el.y), width: pt(el.w), height: pt(el.h) }} data-locked={el.locked ? "" : undefined}>
      {single &&
        !el.locked &&
        HANDLES.map((hd) => (
          <div
            key={hd.name}
            className={classes.handle}
            data-handle={hd.name}
            aria-hidden
            style={{
              width: pt(handle),
              height: pt(handle),
              left: hd.edges.left ? pt(-handle / 2) : hd.edges.right ? undefined : `calc(50% - ${pt(handle / 2)})`,
              right: hd.edges.right ? pt(-handle / 2) : undefined,
              top: hd.edges.top ? pt(-handle / 2) : hd.edges.bottom ? undefined : `calc(50% - ${pt(handle / 2)})`,
              bottom: hd.edges.bottom ? pt(-handle / 2) : undefined,
            }}
            onPointerDown={(e) => {
              gestures.beginResize(e, el, hd.edges);
            }}
          />
        ))}
    </div>
  );
}

function Overlay({ zoom, gestures }: { zoom: number; gestures: Gestures }): ReactElement {
  const { store } = useEditorCtx();
  const selection = useStore(store, (s) => s.selection);
  const editing = useStore(store, (s) => s.editing);
  const guides = useStore(store, (s) => s.preview?.guides ?? null);
  return (
    <div className={classes.overlay} aria-hidden>
      {selection.map((id) => (id === editing ? null : <SelectedBox key={id} id={id} zoom={zoom} single={selection.length === 1} gestures={gestures} />))}
      {guides?.xs.map((x) => <div key={`x${String(x)}`} className={classes.guideX} style={{ left: pt(x) }} />)}
      {guides?.ys.map((y) => <div key={`y${String(y)}`} className={classes.guideY} style={{ top: pt(y) }} />)}
    </div>
  );
}

const MIN_FRAME = 6;
const DEFAULT_FRAME = { w: 144, h: 108 };

// The frame tool: a crosshair layer over the page; dragging draws an empty frame (its corners
// snap), a click without a drag makes a default-sized one there. Escape (page.tsx) cancels.
function FrameTool({ gestures, zoom, onDone }: { gestures: Gestures; zoom: number; onDone: (tool: Tool) => void }): ReactElement {
  const { store } = useEditorCtx();
  const [band, setBand] = useState<Box | null>(null);
  const snapPoint = (p: Point, targets: Targets, alt: boolean): Point => {
    if (alt) return p;
    const { dx, dy } = snapMove({ x: p.x, y: p.y, w: 0, h: 0 }, 0, 0, targets, SNAP_PX / (PX_PER_PT * zoom));
    return { x: p.x + dx, y: p.y + dy };
  };
  return (
    <div
      className={classes.toolLayer}
      aria-hidden
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const doc = store.getDoc();
        const targets = snapTargets(doc.format, doc.grid, doc.elements.filter((el) => !el.hidden).map(boxOf));
        const start = snapPoint(gestures.toPt(e.clientX, e.clientY), targets, e.altKey);
        const boxFrom = (p: Point): Box => ({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
        let last: Box = { ...start, w: 0, h: 0 };
        const move = (ev: PointerEvent) => {
          last = boxFrom(snapPoint(gestures.toPt(ev.clientX, ev.clientY), targets, ev.altKey));
          setBand(last);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          setBand(null);
          const box = last.w >= MIN_FRAME && last.h >= MIN_FRAME ? last : { x: start.x - DEFAULT_FRAME.w / 2, y: start.y - DEFAULT_FRAME.h / 2, ...DEFAULT_FRAME };
          insertFrame(store, box);
          onDone(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      {band && <div className={classes.band} style={{ left: pt(band.x), top: pt(band.y), width: pt(band.w), height: pt(band.h) }} />}
    </div>
  );
}

function GridLines({ w, h, step }: { w: number; h: number; step: number }): ReactElement {
  const id = useId();
  return (
    <svg className={classes.grid} width="100%" height="100%" viewBox={`0 0 ${String(w)} ${String(h)}`} aria-hidden>
      <defs>
        <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M ${String(step)} 0 L 0 0 0 ${String(step)}`} fill="none" stroke="currentColor" strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>
  );
}

export function PageCanvas({ zoom }: { zoom: number }): ReactElement {
  const { store, report, tool, setTool } = useEditorCtx();
  const page = useRef<HTMLDivElement>(null);
  const gestures = useGestures(store, page, zoom);
  const format = useStore(store, (s) => s.doc.format);
  const grid = useStore(store, (s) => s.doc.grid);
  const elements = useStore(store, (s) => s.doc.elements);
  const { w, h } = pageDimensions(format);
  const m = format.margin;

  return (
    <div
      className={classes.area}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        store.edit(null);
        store.select([]);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        const text = e.dataTransfer.getData("text/plain");
        const at = gestures.toPt(e.clientX, e.clientY);
        // The topmost empty frame under the drop point takes it.
        const frame = store
          .getDoc()
          .elements.filter((el) => el.kind === "frame" && !el.hidden && !el.locked && at.x >= el.x && at.x <= el.x + el.w && at.y >= el.y && at.y <= el.y + el.h)
          .at(-1);
        insertData(store, { files, text }, frame ? { frame: frame.id } : { at }).catch(report);
      }}
    >
      <div className={classes.holder} style={{ width: `${String(w * PX_PER_PT * zoom)}px`, height: `${String(h * PX_PER_PT * zoom)}px` }}>
        <div
          ref={page}
          className={classes.page}
          role="group"
          aria-label="Page canvas"
          style={{ width: pt(w), height: pt(h), transform: `scale(${String(zoom)})`, fontFamily: PAGE_FONT }}
        >
          {grid.show && <GridLines w={w} h={h} step={grid.step} />}
          <div className={classes.margin} style={{ left: pt(m), top: pt(m), right: pt(m), bottom: pt(m) }} aria-hidden />
          {elements.map((e) => (
            <ElementView key={e.id} id={e.id} gestures={gestures} />
          ))}
          <Overlay zoom={zoom} gestures={gestures} />
          {tool === "frame" && <FrameTool gestures={gestures} zoom={zoom} onDone={setTool} />}
        </div>
      </div>
    </div>
  );
}
