// "Search and select" for archive entries, opened from the / menu: a dialog with a search box and
// the matching entries; choosing one resolves the promise pickArchive() returned.
// Modal with lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.

import { Modal, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
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

function Results({ q, onPick }: { q: string; onPick: (entry: EntrySummary) => void }): ReactElement {
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
    <ul className={classes.pickerList} aria-label="Archive entries">
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
        onChange={(e) => {
          setQ(e.currentTarget.value);
        }}
        mb="sm"
      />
      {request && (
        <Results
          q={q}
          onPick={(entry) => {
            store.close(entry);
            setQ("");
          }}
        />
      )}
    </Modal>
  );
}
