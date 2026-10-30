// "Search and select" for archive entries, opened from the / menu: a dialog with a search box and
// the matching entries; choosing one resolves the promise pickArchive() returned.
// Keyboard: ArrowDown leaves the search box for the results, ArrowUp/ArrowDown (Home/End) move
// through them and back up to the box, Enter picks (in the box: the first result).
// Modal with lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.

import { Modal, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import type { EntrySummary } from "../../../../../src/shared/archive.ts";
import { listEntries } from "../../../api.ts";
import { Icon } from "../../../icons/Icon.tsx";
import { archiveTypeUi } from "../../archive/types/index.ts";
import type { ArchivePick } from "./context.ts";
import classes from "./Editor.module.css";

type Request = { mode: "embed" | "link"; resolve: (entry: EntrySummary | null) => void };

export function createArchivePicker() {
  let request: Request | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const pick: ArchivePick = (mode) =>
    new Promise((resolve) => {
      request?.resolve(null);
      request = { mode, resolve };
      emit();
    });
  const close = (entry: EntrySummary | null) => {
    request?.resolve(entry);
    request = null;
    emit();
  };
  return {
    pick,
    close,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get: () => request,
  };
}

export type ArchivePickerStore = ReturnType<typeof createArchivePicker>;

const resultButtons = (list: HTMLElement | null) => [...(list?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

// Moves focus between the results; ArrowUp on the first goes back to the search box.
function moveInList(e: KeyboardEvent<HTMLUListElement>, input: RefObject<HTMLInputElement | null>) {
  const buttons = resultButtons(e.currentTarget);
  const at = buttons.findIndex((b) => b === document.activeElement);
  if (at < 0) return;
  const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : null;
  if (next === null) return;
  e.preventDefault();
  if (next < 0) input.current?.focus();
  else buttons[Math.min(next, buttons.length - 1)]?.focus();
}

function Results({ q, onPick, listRef, inputRef }: { q: string; onPick: (entry: EntrySummary) => void; listRef: RefObject<HTMLUListElement | null>; inputRef: RefObject<HTMLInputElement | null> }): ReactElement {
  const [items, setItems] = useState<EntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      listEntries({ q: q.trim() || undefined, limit: 12 }).then(
        (list) => {
          if (!cancelled) {
            setItems(list.items);
            setError(null);
          }
        },
        (err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  if (error) return <Text c="red">{error}</Text>;
  if (items === null) return <Text c="dimmed">Searching…</Text>;
  if (items.length === 0) return <Text c="dimmed">No entries match.</Text>;
  return (
    <ul
      ref={listRef}
      className={classes.pickerList}
      aria-label="Archive entries"
      onKeyDown={(e) => {
        moveInList(e, inputRef);
      }}
    >
      {items.map((entry) => (
        <li key={entry.id}>
          <UnstyledButton
            className={classes.pickerItem}
            onClick={() => {
              onPick(entry);
            }}
          >
            <Icon name={archiveTypeUi[entry.type].icon} />
            <span>
              <Text span size="sm">
                {entry.title}
              </Text>{" "}
              <Text span size="xs" c="dimmed">
                {archiveTypeUi[entry.type].label}
              </Text>
            </span>
          </UnstyledButton>
        </li>
      ))}
    </ul>
  );
}

export function ArchivePicker({ store }: { store: ArchivePickerStore }): ReactElement {
  const request = useSyncExternalStore(store.subscribe, store.get);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <Modal
      opened={request !== null}
      onClose={() => {
        store.close(null);
      }}
      lockScroll={false}
      title={request?.mode === "link" ? "Link to an archive entry" : "Embed an archive entry"}
      size="lg"
    >
      <TextInput
        label="Search the archive"
        placeholder="Words or #tags"
        value={q}
        data-autofocus
        ref={inputRef}
        onKeyDown={(e) => {
          const first = resultButtons(listRef.current)[0];
          if (!first) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            first.focus();
          } else if (e.key === "Enter") {
            e.preventDefault();
            first.click();
          }
        }}
        onChange={(e) => {
          setQ(e.currentTarget.value);
        }}
        mb="sm"
      />
      {request && (
        <Results
          q={q}
          listRef={listRef}
          inputRef={inputRef}
          onPick={(entry) => {
            store.close(entry);
            setQ("");
          }}
        />
      )}
    </Modal>
  );
}
