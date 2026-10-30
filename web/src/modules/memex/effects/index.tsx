// The effects' web side (their schemas: EffectSchema in src/shared/memex-doc.ts): a default for
// a new one and the fields that edit its params. How each draws: grayscale is a CSS filter on the
// element's frame (render/units.ts frameStyle), halftone replaces the picture (Halftone.tsx).
// Adding an effect: AGENTS.md "Memex", "Add an effect".

import { Checkbox, NativeSelect, NumberInput, Stack } from "@mantine/core";
import type { ReactElement } from "react";
import { HalftoneShapeSchema, type Effect, type EffectType, type HalftoneEffect } from "../../../../../src/shared/memex-doc.ts";

type ParamsEditor<E extends Effect> = (props: { effect: E; label: string; onChange: (next: E) => void }) => ReactElement;

const clampNumber = (v: number | string, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);

const HalftoneParams: ParamsEditor<HalftoneEffect> = ({ effect, label, onChange }) => (
  <Stack gap={6}>
    <NumberInput
      size="xs"
      label={`${label}: dot spacing (pt)`}
      min={1.5}
      max={48}
      step={0.5}
      decimalScale={1}
      value={effect.cell}
      onChange={(v) => {
        const cell = clampNumber(v, 1.5, 48);
        if (cell !== null) onChange({ ...effect, cell });
      }}
    />
    <NumberInput
      size="xs"
      label={`${label}: screen angle (°)`}
      min={0}
      max={90}
      value={effect.angle}
      onChange={(v) => {
        const angle = clampNumber(v, 0, 90);
        if (angle !== null) onChange({ ...effect, angle });
      }}
    />
    <NativeSelect
      size="xs"
      label={`${label}: dot shape`}
      data={HalftoneShapeSchema.options.map((s) => ({ value: s, label: s === "circle" ? "Round" : "Square" }))}
      value={effect.shape}
      onChange={(e) => {
        const shape = HalftoneShapeSchema.safeParse(e.currentTarget.value);
        if (shape.success) onChange({ ...effect, shape: shape.data });
      }}
    />
    <Checkbox
      size="xs"
      label={`${label}: invert (dots for the light parts)`}
      checked={effect.invert}
      onChange={(e) => {
        onChange({ ...effect, invert: e.currentTarget.checked });
      }}
    />
  </Stack>
);

export const EFFECT_UI = {
  grayscale: { create: (): Effect => ({ type: "grayscale" }), Params: null },
  halftone: { create: (): Effect => ({ type: "halftone", cell: 6, angle: 45, shape: "circle", invert: false }), Params: HalftoneParams },
} as const satisfies { [T in EffectType]: { create: () => Effect; Params: ParamsEditor<Extract<Effect, { type: T }>> | null } };

// The params fields of one effect (switched on its type so each gets its own shape).
export function EffectParams({ effect, label, onChange }: { effect: Effect; label: string; onChange: (next: Effect) => void }): ReactElement | null {
  switch (effect.type) {
    case "grayscale":
      return null;
    case "halftone":
      return <EFFECT_UI.halftone.Params effect={effect} label={label} onChange={onChange} />;
  }
}
