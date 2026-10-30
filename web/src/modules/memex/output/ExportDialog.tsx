// "Print or export…": pick a sequence of pages (search, add, put in order), choose one page per
// sheet or copies on Letter, and open the print view, where the print dialog makes the print or
// PDF and "Download HTML" the file. Outputs are a registry of their own in spirit: each is an
// action on the print view (PrintView.tsx); an e-reader export would be another.

import { ActionIcon, Button, Group, Modal, NativeSelect, Text, TextInput, Title } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import type { MemexPageSummary } from "../../../../../src/shared/memex.ts";
import { listMemexPages } from "../../../api.ts";
import { Icon } from "../../../icons/Icon.tsx";
import classes from "../Memex.module.css";
import { LAYOUTS, type Layout } from "./impose.ts";

const SEARCH_DELAY_MS = 200;

type Picked = { id: string; title: string };

// The lists have a fixed height and keep room for their scroll bars, so adding, moving or removing
// pages never shifts the buttons under the pointer; no tooltips (their names are labels).
// lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.
export function ExportDialog({ opened, onClose, initial }: { opened: boolean; onClose: () => void; initial: string[] }): ReactElement {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<MemexPageSummary[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [layout, setLayout] = useState<Layout>("single");
  const [error, setError] = useState<string | null>(null);

  // Opening starts from the page being edited, if any.
  useEffect(() => {
    if (!opened) return;
    setPicked([]);
    setError(null);
    if (initial.length === 0) return;
    listMemexPages({ limit: 500 }).then(
      (list) => {
        setPicked(initial.flatMap((id) => list.items.filter((p) => p.id === id).map((p) => ({ id: p.id, title: p.title }))));
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    // `initial` is read when the dialog opens
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    const timer = setTimeout(() => {
      listMemexPages({ q: q.trim() || undefined, limit: 50 }).then(
        (list) => {
          setFound(list.items);
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [q, opened]);

  const move = (i: number, by: number) => {
    setPicked((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      if (item) next.splice(Math.max(0, Math.min(next.length, i + by)), 0, item);
      return next;
    });
  };

  return (
    <Modal opened={opened} onClose={onClose} lockScroll={false} title="Print or export pages" size="lg">
      <div className={classes.exportGrid}>
        <section aria-labelledby="export-find">
          <Title order={3} size="h6" id="export-find" mb={4}>
            Find pages
          </Title>
          <TextInput label="Search pages" placeholder="Words or #tags" value={q} onChange={(e) => { setQ(e.currentTarget.value); }} size="xs" mb="xs" />
          <ul className={classes.exportList} aria-label="Pages found">
            {found.map((p) => {
              const title = p.title || "Untitled";
              return (
                <li key={p.id}>
                  <Text size="sm" className={classes.exportTitle}>
                    {title}
                  </Text>
                  <Button size="compact-xs" variant="light" aria-label={`Add ${title}`} onClick={() => { setPicked((list) => [...list, { id: p.id, title: p.title }]); }}>
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="export-picked">
          <Title order={3} size="h6" id="export-picked" mb={4}>
            To print, in this order
          </Title>
          {picked.length === 0 ? (
            <Text size="sm" c="dimmed" className={classes.exportList}>
              Add pages from the left.
            </Text>
          ) : (
            <ol className={classes.exportList} aria-label="Pages to print">
              {picked.map((p, i) => {
                const title = p.title || "Untitled";
                return (
                  <li key={`${p.id}-${String(i)}`}>
                    <Text size="sm" className={classes.exportTitle}>
                      {title}
                    </Text>
                    <Group gap={0} wrap="nowrap">
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Move ${title} earlier`} disabled={i === 0} onClick={() => { move(i, -1); }}>
                          <Icon name="angle-up" />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Move ${title} later`} disabled={i === picked.length - 1} onClick={() => { move(i, 1); }}>
                          <Icon name="angle-down" />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Remove ${title}`} onClick={() => { setPicked((list) => list.filter((_, j) => j !== i)); }}>
                          <Icon name="trash" />
                        </ActionIcon>
                    </Group>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
      {error && (
        <Text c="red" size="sm" mt="sm">
          {error}
        </Text>
      )}
      <Group justify="space-between" mt="md" align="flex-end">
        <NativeSelect
          size="xs"
          label="Layout"
          data={[
            { value: "single", label: "One page per sheet" },
            { value: "copies", label: "Copies on Letter (2 or 4 up)" },
          ]}
          value={layout}
          onChange={(e) => {
            const next = LAYOUTS.find((l) => l === e.currentTarget.value);
            if (next) setLayout(next);
          }}
        />
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Icon name="print" />}
            disabled={picked.length === 0}
            onClick={() => {
              onClose();
              void navigate({ to: "/memex/print", search: { pages: picked.map((p) => p.id).join(","), layout } });
            }}
          >
            Open the print view
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
