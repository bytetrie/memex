// The right-hand column above the layers: what is selected and its settings. Nothing selected:
// the page (size, orientation, margin, grid). One element: its position and size, its kind's
// settings and its effects. Several: what can be done to all of them.
// Every change is one undo step; typing into the same field merges into one (store.ts).

import { ActionIcon, Button, ColorInput, Group, NativeSelect, NumberInput, Switch, Text, Textarea, TextInput, Title, Tooltip } from "@mantine/core";
import { useState, type ReactElement } from "react";
import {
  EFFECT_TYPES,
  FONT_FAMILIES,
  FontFamilySchema,
  QrEccSchema,
  type QrElement,
  EFFECTS,
  effectApplies,
  ImageFitSchema,
  MARGINS,
  MarginSchema,
  MAX_EFFECTS,
  OrientationSchema,
  PAGE_SIZES,
  PageSizeSchema,
  TextAlignSchema,
  type Effect,
  type MediaElement,
  type PageElement,
  type TextElement,
} from "../../../../src/shared/memex-doc.ts";
import { Icon } from "../../icons/Icon.tsx";
import { useEditorCtx } from "./canvas/context.ts";
import { duplicateElements, removeElements, setFormat, setGrid, updateElements, type ElementPatch } from "./doc/commands.ts";
import { useElement, useStore } from "./doc/store.ts";
import { EFFECT_UI, EffectParams } from "./effects/index.tsx";
import { insertTextBox } from "./insert.ts";
import { KINDS, labelOf } from "./kinds/index.tsx";
import { encodeQr } from "./kinds/qr/encode.ts";
import { ECC_LABELS } from "./kinds/qr/QrDialog.tsx";
import classes from "./Memex.module.css";

const num = (v: number | string, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const MARGIN_LABELS = new Map<number, string>([[18, "0.25 in"], [36, "0.5 in"], [72, "1 in"]]);

function PageSettings(): ReactElement {
  const { store } = useEditorCtx();
  const format = useStore(store, (s) => s.doc.format);
  const grid = useStore(store, (s) => s.doc.grid);
  return (
    <section aria-labelledby="memex-page-settings" className={classes.panel}>
      <Title order={2} size="h6" id="memex-page-settings">
        Page
      </Title>
      <NativeSelect
        size="xs"
        label="Size"
        data={PageSizeSchema.options.map((s) => ({ value: s, label: PAGE_SIZES[s].label }))}
        value={format.size}
        onChange={(e) => {
          const size = PageSizeSchema.safeParse(e.currentTarget.value);
          if (size.success) store.commit(setFormat(store.getDoc(), { size: size.data }));
        }}
      />
      <NativeSelect
        size="xs"
        label="Orientation"
        data={OrientationSchema.options.map((o) => ({ value: o, label: o === "portrait" ? "Portrait" : "Landscape" }))}
        value={format.orientation}
        onChange={(e) => {
          const orientation = OrientationSchema.safeParse(e.currentTarget.value);
          if (orientation.success) store.commit(setFormat(store.getDoc(), { orientation: orientation.data }));
        }}
      />
      <NativeSelect
        size="xs"
        label="Margin"
        data={MARGINS.map((m) => ({ value: String(m), label: MARGIN_LABELS.get(m) ?? `${String(m)} pt` }))}
        value={String(format.margin)}
        onChange={(e) => {
          const margin = MarginSchema.safeParse(Number(e.currentTarget.value));
          if (margin.success) store.commit(setFormat(store.getDoc(), { margin: margin.data }));
        }}
      />
      <Switch size="xs" label="Show the grid" checked={grid.show} onChange={(e) => { store.commit(setGrid(store.getDoc(), { show: e.currentTarget.checked })); }} />
      <Switch size="xs" label="Snap to the grid" checked={grid.snap} onChange={(e) => { store.commit(setGrid(store.getDoc(), { snap: e.currentTarget.checked })); }} />
      <NumberInput
        size="xs"
        label="Grid step (pt)"
        min={2}
        max={144}
        value={grid.step}
        onChange={(v) => {
          const step = num(v, 2, 144);
          if (step !== null) store.commit(setGrid(store.getDoc(), { step }), { merge: "grid.step" });
        }}
      />
      <Text size="xs" c="dimmed">
        Paste or drop images, SVGs, text, or a drawing copied from Excalidraw (Ctrl+C in a notes drawing). Snapping: hold Alt to place freely.
      </Text>
    </section>
  );
}

function TextSettings({ el, update }: { el: TextElement; update: (p: ElementPatch, merge?: string) => void }): ReactElement {
  const { store } = useEditorCtx();
  return (
    <>
      <Group grow gap="xs">
        <NumberInput size="xs" label="Text size (pt)" min={4} max={400} value={el.fontSize} onChange={(v) => { const n = num(v, 4, 400); if (n !== null) update({ fontSize: n }, "fontSize"); }} />
        <NumberInput size="xs" label="Line height" min={0.8} max={3} step={0.05} decimalScale={2} value={el.lineHeight} onChange={(v) => { const n = num(v, 0.8, 3); if (n !== null) update({ lineHeight: n }, "lineHeight"); }} />
      </Group>
      <NativeSelect
        size="xs"
        label="Font"
        data={FontFamilySchema.options.map((f) => ({ value: f, label: FONT_FAMILIES[f].label }))}
        value={el.font}
        onChange={(e) => {
          const font = FontFamilySchema.safeParse(e.currentTarget.value);
          if (font.success) update({ font: font.data });
        }}
      />
      <Group grow gap="xs">
        <NativeSelect
          size="xs"
          label="Align"
          data={TextAlignSchema.options.map((a) => ({ value: a, label: a === "center" ? "Centre" : a === "left" ? "Left" : "Right" }))}
          value={el.align}
          onChange={(e) => {
            const align = TextAlignSchema.safeParse(e.currentTarget.value);
            if (align.success) update({ align: align.data });
          }}
        />
        <ColorInput size="xs" label="Colour" format="hex" value={el.color} withEyeDropper={false} onChange={(color) => { if (/^#[0-9a-f]{6}$/i.test(color)) update({ color }, "color"); }} />
      </Group>
      <Button size="xs" variant="light" leftSection={<Icon name="pencil" />} disabled={el.locked} onClick={() => { store.edit(el.id); }}>
        Edit text
      </Button>
    </>
  );
}

function MediaSettings({ el, update }: { el: MediaElement; update: (p: ElementPatch) => void }): ReactElement {
  return (
    <NativeSelect
      size="xs"
      label="Fit"
      data={ImageFitSchema.options.map((f) => ({ value: f, label: { contain: "Fit inside the box", cover: "Fill the box (crop)", fill: "Stretch to the box" }[f] }))}
      value={el.fit}
      onChange={(e) => {
        const fit = ImageFitSchema.safeParse(e.currentTarget.value);
        if (fit.success) update({ fit: fit.data });
      }}
    />
  );
}

function QrSettings({ el, update }: { el: QrElement; update: (p: ElementPatch, merge?: string) => void }): ReactElement {
  const [draft, setDraft] = useState(el.text);
  let problem: string | null = null;
  try {
    encodeQr(draft, el.ecc);
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  return (
    <>
      <Textarea
        size="xs"
        label="QR code text or link"
        autosize
        minRows={2}
        maxRows={6}
        maxLength={2000}
        value={draft}
        error={draft.trim() ? problem : "The code needs some text."}
        onChange={(e) => {
          const text = e.currentTarget.value;
          setDraft(text);
          try {
            if (text.trim()) {
              encodeQr(text, el.ecc);
              update({ text }, "qr.text");
            }
          } catch {
            // shown as the field's error; the code keeps its last good text
          }
        }}
      />
      <NativeSelect
        size="xs"
        label="Error correction"
        data={QrEccSchema.options.map((v) => ({ value: v, label: ECC_LABELS.get(v) ?? v }))}
        value={el.ecc}
        onChange={(e) => {
          const ecc = QrEccSchema.safeParse(e.currentTarget.value);
          if (ecc.success) update({ ecc: ecc.data });
        }}
      />
      <Group grow gap="xs" align="flex-end">
        <ColorInput size="xs" label="Colour" format="hex" value={el.color} withEyeDropper={false} onChange={(color) => { if (/^#[0-9a-f]{6}$/i.test(color)) update({ color }, "color"); }} />
        <Switch size="xs" label="Quiet zone" checked={el.quiet} onChange={(e) => { update({ quiet: e.currentTarget.checked }); }} />
      </Group>
    </>
  );
}

function FrameSettings(): ReactElement {
  const { store, chooseImage, openDrawing, openQr } = useEditorCtx();
  return (
    <>
      <Text size="xs" c="dimmed">
        An empty frame: what you drop or paste on it (with it selected), or choose here, takes its place, fitted inside it. It doesn&apos;t print.
      </Text>
      <Group gap="xs">
        <Button size="xs" variant="light" leftSection={<Icon name="picture" />} onClick={chooseImage}>
          Choose an image…
        </Button>
        <Button size="xs" variant="light" leftSection={<Icon name="brush" />} onClick={() => { openDrawing(); }}>
          Draw here…
        </Button>
        <Button size="xs" variant="light" leftSection={<Icon name="qrcode" />} onClick={openQr}>
          QR code here…
        </Button>
        <Button size="xs" variant="light" leftSection={<Icon name="font" />} onClick={() => { store.edit(insertTextBox(store)); }}>
          Text here
        </Button>
      </Group>
    </>
  );
}

function KindSettings({ el, update }: { el: PageElement; update: (p: ElementPatch, merge?: string) => void }): ReactElement {
  const { openDrawing } = useEditorCtx();
  switch (el.kind) {
    case "text":
      return <TextSettings el={el} update={update} />;
    case "image":
    case "svg":
      return <MediaSettings el={el} update={update} />;
    case "excalidraw":
      return (
        <>
          <MediaSettings el={el} update={update} />
          <Button size="xs" variant="light" leftSection={<Icon name="brush" />} disabled={el.locked} onClick={() => { openDrawing(el.id); }}>
            Edit drawing
          </Button>
        </>
      );
    case "qr":
      return <QrSettings key={el.id} el={el} update={update} />;
    case "frame":
      return <FrameSettings />;
  }
}

function Effects({ el, update }: { el: PageElement; update: (p: ElementPatch, merge?: string) => void }): ReactElement {
  const available = EFFECT_TYPES.filter((t) => effectApplies(t, el.kind) && !el.effects.some((e) => e.type === t));
  const set = (effects: Effect[], merge?: string) => {
    update({ effects }, merge);
  };
  return (
    <section aria-labelledby="memex-effects" className={classes.subpanel}>
      <Title order={3} size="h6" id="memex-effects">
        Effects
      </Title>
      {el.effects.length === 0 && (
        <Text size="xs" c="dimmed">
          None.
        </Text>
      )}
      <ul className={classes.effects}>
        {el.effects.map((effect, i) => {
          const label = EFFECTS[effect.type].label;
          return (
            <li key={effect.type}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm" fw={500}>
                  {label}
                </Text>
                <Tooltip label={`Remove ${label}`}>
                  <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Remove ${label}`} onClick={() => { set(el.effects.filter((_, j) => j !== i)); }}>
                    <Icon name="trash" />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <EffectParams effect={effect} label={label} onChange={(next) => { set(el.effects.map((e, j) => (j === i ? next : e)), `effect:${effect.type}`); }} />
            </li>
          );
        })}
      </ul>
      {available.length > 0 && el.effects.length < MAX_EFFECTS && (
        <Group gap="xs">
          {available.map((t) => (
            <Button key={t} size="compact-xs" variant="light" leftSection={<Icon name="plus" />} onClick={() => { set([...el.effects, EFFECT_UI[t].create()]); }}>
              {EFFECTS[t].label}
            </Button>
          ))}
        </Group>
      )}
    </section>
  );
}

function ElementSettings({ id }: { id: string }): ReactElement | null {
  const { store } = useEditorCtx();
  const el = useElement(store, id);
  if (!el) return null;
  const update = (patch: ElementPatch, merge?: string) => {
    store.commit(updateElements(store.getDoc(), [id], patch), { merge: merge === undefined ? undefined : `${id}:${merge}` });
  };
  const field = (label: string, key: "x" | "y" | "w" | "h" | "rotation", min: number, max: number) => (
    <NumberInput
      size="xs"
      label={label}
      min={min}
      max={max}
      decimalScale={1}
      value={Math.round(el[key] * 10) / 10}
      onChange={(v) => {
        const n = num(v, min, max);
        if (n !== null) update({ [key]: n }, key);
      }}
    />
  );
  return (
    <section aria-labelledby="memex-element-settings" className={classes.panel}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Title order={2} size="h6" id="memex-element-settings">
          {KINDS[el.kind].label}
        </Title>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Duplicate (Ctrl+D)">
            <ActionIcon size="sm" variant="subtle" aria-label="Duplicate" onClick={() => { const d = duplicateElements(store.getDoc(), [id]); store.commit(d.doc, { select: d.ids }); }}>
              <Icon name="docs" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete (Delete)">
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Delete" onClick={() => { store.commit(removeElements(store.getDoc(), [id])); }}>
              <Icon name="trash" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <TextInput size="xs" label="Name" placeholder={labelOf({ ...el, name: undefined })} value={el.name ?? ""} onChange={(e) => { const name = e.currentTarget.value; update({ name: name.trim() ? name.slice(0, 100) : undefined }, "name"); }} />
      <div className={classes.fields}>
        {field("X (pt)", "x", -5000, 5000)}
        {field("Y (pt)", "y", -5000, 5000)}
        {field("Width (pt)", "w", 1, 5000)}
        {field("Height (pt)", "h", 1, 5000)}
        {field("Rotation (°)", "rotation", -360, 360)}
        <NumberInput
          size="xs"
          label="Opacity (%)"
          min={0}
          max={100}
          value={Math.round(el.opacity * 100)}
          onChange={(v) => {
            const n = num(v, 0, 100);
            if (n !== null) update({ opacity: n / 100 }, "opacity");
          }}
        />
      </div>
      <KindSettings el={el} update={update} />
      <Effects el={el} update={update} />
    </section>
  );
}

function ManySelected({ ids }: { ids: readonly string[] }): ReactElement {
  const { store } = useEditorCtx();
  return (
    <section aria-labelledby="memex-many" className={classes.panel}>
      <Title order={2} size="h6" id="memex-many">
        {ids.length} elements selected
      </Title>
      <Group gap="xs">
        <Button size="xs" variant="light" leftSection={<Icon name="docs" />} onClick={() => { const d = duplicateElements(store.getDoc(), ids); store.commit(d.doc, { select: d.ids }); }}>
          Duplicate
        </Button>
        <Button size="xs" variant="light" color="red" leftSection={<Icon name="trash" />} onClick={() => { store.commit(removeElements(store.getDoc(), ids)); }}>
          Delete
        </Button>
      </Group>
    </section>
  );
}

export function Inspector(): ReactElement {
  const { store } = useEditorCtx();
  const selection = useStore(store, (s) => s.selection);
  const [first] = selection;
  if (first === undefined) return <PageSettings />;
  if (selection.length > 1) return <ManySelected ids={selection} />;
  return <ElementSettings key={first} id={first} />;
}
