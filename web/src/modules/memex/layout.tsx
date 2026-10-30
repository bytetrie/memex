// /memex is a layout: the pane (new page, print or export, search, tags, the pages) beside the page
// being edited, which takes the rest of the width. The pane folds away (remembered per browser).
// The search and tag filter live in the URL; the list refetches itself when pages change.
// Same shape as the notes pane (notes/layout.tsx).

import { ActionIcon, Badge, Button, CloseButton, Group, Menu, Modal, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { createRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import { PAGE_SIZES } from "../../../../src/shared/memex-doc.ts";
import type { MemexPageList, MemexPageSummary } from "../../../../src/shared/memex.ts";
import type { TagCount } from "../../../../src/shared/notes.ts";
import { createMemexPage, deleteMemexPage, getMemexTags, listMemexPages } from "../../api.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import { rootRoute } from "../../root.tsx";
import { memexPagesChanged, onMemexPagesChanged } from "./events.ts";
import classes from "./Memex.module.css";
import { ExportDialog } from "./output/ExportDialog.tsx";

const SEARCH_DELAY_MS = 250;
const PAGE_LIMIT = 200;
const PANE_KEY = "memex.pane";

const SearchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
});

const loadList = (q?: string, tag?: string) => Promise.all([listMemexPages({ q, tag, limit: PAGE_LIMIT }), getMemexTags()]).then(([pages, tags]) => ({ pages, tags }));

export const memexLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memex",
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, tag: search.tag }),
  loader: ({ deps }) => loadList(deps.q, deps.tag),
  component: MemexLayout,
});

function usePaneOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return typeof localStorage === "undefined" || localStorage.getItem(PANE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(PANE_KEY, next ? "open" : "closed");
    } catch {
      // not remembered, that's all
    }
  };
  return [open, set];
}

function MemexLayout(): ReactElement {
  const loaded = memexLayout.useLoaderData();
  const search = memexLayout.useSearch();
  const [list, setList] = useState<{ pages: MemexPageList; tags: TagCount[] }>(loaded);
  const [open, setOpen] = usePaneOpen();

  useEffect(() => {
    setList(loaded);
  }, [loaded]);
  useEffect(
    () =>
      onMemexPagesChanged(() => {
        loadList(search.q, search.tag).then(setList, (err: unknown) => {
          console.error("memex: reloading the page list failed", err);
        });
      }),
    [search.q, search.tag],
  );

  return (
    <div className={classes.layout} data-pane={open ? "open" : "closed"}>
      {open ? (
        <Pane pages={list.pages} tags={list.tags} onFold={() => { setOpen(false); }} />
      ) : (
        <Tooltip label="Show the pages" position="right">
          <ActionIcon className={classes.unfold} variant="default" size="lg" aria-label="Show the pages" aria-expanded={false} onClick={() => { setOpen(true); }}>
            <Icon name="angle-right" />
          </ActionIcon>
        </Tooltip>
      )}
      <div className={classes.content}>
        <Outlet />
      </div>
    </div>
  );
}

function Pane({ pages, tags, onFold }: { pages: MemexPageList; tags: TagCount[]; onFold: () => void }): ReactElement {
  const search = memexLayout.useSearch();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MemexPageSummary | null>(null);
  const filtered = Boolean(search.q || search.tag);

  const typed = useRef(search.q ?? "");
  useEffect(() => {
    const fromUrl = search.q ?? "";
    if (fromUrl === typed.current) return;
    typed.current = fromUrl;
    setQ(fromUrl);
  }, [search.q]);
  useEffect(() => {
    if (q === typed.current) return;
    const timer = setTimeout(() => {
      typed.current = q;
      void navigate({ to: ".", search: (prev) => ({ ...prev, q: q.trim() || undefined }), replace: true });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [q, navigate]);

  const clearFilters = () => {
    typed.current = "";
    setQ("");
    void navigate({ to: ".", search: {} });
  };

  async function newPage() {
    setCreating(true);
    setError(null);
    try {
      const page = await createMemexPage({ tags: search.tag ? [search.tag] : [] });
      await navigate({ to: "/memex/p/$pageId", params: { pageId: page.id }, search: (prev) => prev });
      memexPagesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className={classes.pane} aria-label="Memex">
      <Group gap="xs" wrap="nowrap">
        <Button className={classes.grow} leftSection={<Icon name="plus" />} onClick={() => void newPage()} loading={creating}>
          New page
        </Button>
        <Tooltip label="Hide the pages">
          <ActionIcon variant="subtle" size="lg" aria-label="Hide the pages" aria-expanded onClick={onFold}>
            <Icon name="angle-left" />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Button variant="light" leftSection={<Icon name="print" />} onClick={() => { setExporting(true); }}>
        Print or export…
      </Button>
      {error && <Text c="red">{error}</Text>}
      <form role="search" aria-label="Search memex pages" onSubmit={(e) => { e.preventDefault(); }}>
        <TextInput
          label="Search"
          placeholder="Words or #tags"
          leftSection={<Icon name="search" />}
          rightSection={q ? <CloseButton size="sm" aria-label="Clear the search" onClick={() => { setQ(""); }} /> : null}
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
          }}
        />
      </form>

      {tags.length > 0 && (
        <section aria-labelledby="memex-tags-heading">
          <Title order={2} size="h6" id="memex-tags-heading" mb={4}>
            Tags
          </Title>
          <ul className={classes.tags}>
            {tags.map(({ tag, count }) => {
              const active = search.tag === tag;
              return (
                <li key={tag}>
                  <AnchorLink
                    to="."
                    search={(prev) => ({ ...prev, tag: active ? undefined : tag })}
                    aria-current={active ? "true" : undefined}
                    aria-label={active ? `${tag}: stop filtering by this tag` : `${tag}: show only pages with this tag`}
                    underline="never"
                  >
                    <Badge variant={active ? "filled" : "light"} rightSection={String(count)} className={classes.tagBadge}>
                      {tag}
                    </Badge>
                  </AnchorLink>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav aria-labelledby="memex-pages-heading">
        <Group justify="space-between" mb={4} gap="xs">
          <Title order={2} size="h6" id="memex-pages-heading">
            {filtered ? "Matching pages" : "Pages"}
          </Title>
          {filtered && (
            <Button size="compact-xs" variant="subtle" onClick={clearFilters}>
              Show all pages
            </Button>
          )}
        </Group>
        {pages.items.length === 0 ? (
          <Text c="dimmed" size="sm">
            {filtered ? "No page matches." : "No pages yet."}
          </Text>
        ) : (
          <ul className={classes.list}>
            {pages.items.map((page) => (
              <PageItem key={page.id} page={page} onDelete={() => { setDeleting(page); }} />
            ))}
          </ul>
        )}
        {pages.nextCursor && (
          <Text c="dimmed" size="xs" mt={4}>
            Showing the {String(PAGE_LIMIT)} most recently edited; search to find older pages.
          </Text>
        )}
      </nav>
      <DeleteDialog page={deleting} onClose={() => { setDeleting(null); }} />
      <ExportDialog opened={exporting} onClose={() => { setExporting(false); }} initial={params.pageId ? [params.pageId] : []} />
    </aside>
  );
}

function PageItem({ page, onDelete }: { page: MemexPageSummary; onDelete: () => void }): ReactElement {
  const title = page.title || "Untitled";
  return (
    <li className={classes.pageItem}>
      <AnchorLink
        to="/memex/p/$pageId"
        params={{ pageId: page.id }}
        search={(prev) => prev}
        preload={false}
        className={classes.pageLink}
        activeProps={{ "aria-current": "page" }}
        underline="never"
      >
        <span className={classes.pageTitle}>{title}</span>
        <Text span size="xs" c="dimmed" className={classes.pageFormat}>
          {PAGE_SIZES[page.format.size].label.replace(" Letter", "")}
        </Text>
      </AnchorLink>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon className={classes.pageMenu} variant="subtle" color="gray" size="sm" aria-label={`Actions for ${title}`}>
            <Icon name="ellipsis-vert" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item color="red" leftSection={<Icon name="trash" />} onClick={onDelete}>
            Delete page
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </li>
  );
}

// lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.
function DeleteDialog({ page, onClose }: { page: MemexPageSummary | null; onClose: () => void }): ReactElement {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const [error, setError] = useState<string | null>(null);
  const title = page?.title || "Untitled";

  async function remove() {
    if (!page) return;
    try {
      // Leave the page first, so its editor saves (and stops) before the page is gone.
      if (params.pageId === page.id) await navigate({ to: "/memex", search: (prev) => prev });
      await deleteMemexPage(page.id);
      setError(null);
      onClose();
      memexPagesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal opened={page !== null} onClose={onClose} lockScroll={false} title="Delete this page?">
      <Text size="sm" mb="md">
        “{title}” will be deleted.
      </Text>
      {error && (
        <Text c="red" size="sm" mb="sm">
          {error}
        </Text>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button color="red" onClick={() => void remove()}>
          Delete page
        </Button>
      </Group>
    </Modal>
  );
}
