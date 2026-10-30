// The page's elements as a list, top layer first: click selects (Shift adds or removes). The
// controls above the list act on what is selected: a layer up or down (Ctrl+] / Ctrl+[), to the
// top or bottom, hide or show, lock or unlock. Rows show only the name, and whether the element
// is hidden or locked. The keyboard way to reach every element.

import { ActionIcon, Group, Text, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { memo, type ReactElement } from "react";
import { Icon } from "../../icons/Icon.tsx";
import type { IconName } from "../../icons/names.ts";
import { useEditorCtx } from "./canvas/context.ts";
import { reorderElements, updateElements, type Reorder } from "./doc/commands.ts";
import { useElement, useStore } from "./doc/store.ts";
import { KINDS, labelOf } from "./kinds/index.tsx";
import classes from "./Memex.module.css";

const LayerRow = memo(function LayerRow({ id }: { id: string }): ReactElement | null {
  const { store } = useEditorCtx();
  const el = useElement(store, id);
  const selected = useStore(store, (s) => s.selection.includes(id));
  if (!el) return null;
  return (
    <li className={classes.layer} data-selected={selected ? "" : undefined} data-hidden={el.hidden ? "" : undefined}>
      <UnstyledButton
        className={classes.layerName}
        aria-pressed={selected}
        onClick={(e) => {
          const sel = store.getState().selection;
          store.select(e.shiftKey ? (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]) : [id]);
        }}
      >
        <Icon name={KINDS[el.kind].icon} />
        <Text span size="sm" className={classes.layerText}>
          {labelOf(el)}
        </Text>
        {el.hidden && (
          <span className={classes.layerState} title="Hidden">
            <Icon name="eye-off" />
          </span>
        )}
        {el.locked && (
          <span className={classes.layerState} title="Locked">
            <Icon name="lock" />
          </span>
        )}
      </UnstyledButton>
    </li>
  );
});

function LayerControls(): ReactElement {
  const { store } = useEditorCtx();
  const selection = useStore(store, (s) => s.selection);
  const elements = useStore(store, (s) => s.doc.elements);
  const picked = elements.filter((e) => selection.includes(e.id));
  const none = picked.length === 0;
  const ids = picked.map((e) => e.id);
  const top = !none && elements.slice(-picked.length).every((e) => selection.includes(e.id));
  const bottom = !none && elements.slice(0, picked.length).every((e) => selection.includes(e.id));
  const allHidden = !none && picked.every((e) => e.hidden);
  const allLocked = !none && picked.every((e) => e.locked);
  const reorder = (how: Reorder) => {
    store.commit(reorderElements(store.getDoc(), ids, how));
  };
  const button = (label: string, icon: IconName, onClick: () => void, disabled: boolean, pressed?: boolean) => (
    <Tooltip label={label}>
      <ActionIcon size="sm" variant={pressed ? "filled" : "default"} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        <Icon name={icon} />
      </ActionIcon>
    </Tooltip>
  );
  return (
    <Group gap={4} role="toolbar" aria-label="Selected layers">
      {button("Bring forward", "angle-up", () => { reorder("forward"); }, none || top)}
      {button("Send backward", "angle-down", () => { reorder("backward"); }, none || bottom)}
      {button("Bring to front", "angle-double-up", () => { reorder("front"); }, none || top)}
      {button("Send to back", "angle-double-down", () => { reorder("back"); }, none || bottom)}
      {button(allHidden ? "Show" : "Hide", allHidden ? "eye-off" : "eye", () => { store.commit(updateElements(store.getDoc(), ids, { hidden: !allHidden })); }, none, allHidden)}
      {button(allLocked ? "Unlock" : "Lock", allLocked ? "lock" : "lock-open", () => { store.commit(updateElements(store.getDoc(), ids, { locked: !allLocked })); }, none, allLocked)}
    </Group>
  );
}

export function LayersPanel(): ReactElement {
  const { store } = useEditorCtx();
  const ids = useStore(store, (s) => s.doc.elements).map((e) => e.id);
  const topFirst = [...ids].reverse();
  return (
    <section aria-labelledby="memex-layers" className={classes.panel}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Title order={2} size="h6" id="memex-layers">
          Layers
        </Title>
        <LayerControls />
      </Group>
      {topFirst.length === 0 ? (
        <Text size="xs" c="dimmed">
          Nothing on this page yet.
        </Text>
      ) : (
        <ul className={classes.layers} aria-label="Layers, top first">
          {topFirst.map((id) => (
            <LayerRow key={id} id={id} />
          ))}
        </ul>
      )}
    </section>
  );
}
