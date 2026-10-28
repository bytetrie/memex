// /notes is a layout: the pane (new page, search, tags, the pages) beside whatever page is open.
// The page sits in the middle of the view whether the pane is shown or folded away (the fold is
// remembered per browser); it moves aside only when the view is too narrow for both.
// The search and tag filter live in the URL (validated search params), so they survive opening
// pages. The list refetches itself when pages change (events.ts), not through the router.

import { ActionIcon, Badge, Button, CloseButton, Group, Menu, Modal, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { createRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import type { PageList, PageSummary, TagCount } from "../../../../src/shared/notes.ts";
import { createPage, deletePage, getNoteTags, listPages } from "../../api.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import { rootRoute } from "../../root.tsx";
import { onPagesChanged, pagesChanged } from "./events.ts";
import classes from "./Notes.module.css";

const SEARCH_DELAY_MS = 250;
const PAGE_LIMIT = 200;
const PANE_KEY = "notes.pane";

const SearchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
});

const loadList = (q?: string, tag?: string) => Promise.all([listPages({ q, tag, limit: PAGE_LIMIT }), getNoteTags()]).then(([pages, tags]) => ({ pages, tags }));

export const notesLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, tag: search.tag }),
  loader: ({ deps }) => loadList(deps.q, deps.tag),
  component: NotesLayout,
});

// Whether the pane is shown, remembered in this browser (a convenience: storage may be unavailable).
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

function NotesLayout(): ReactElement {
  const loaded = notesLayout.useLoaderData();
  const search = notesLayout.useSearch();
  const [list, setList] = useState<{ pages: PageList; tags: TagCount[] }>(loaded);
  const [open, setOpen] = usePaneOpen();

  useEffect(() => {
    setList(loaded);
  }, [loaded]);
  useEffect(
    () =>
      onPagesChanged(() => {
        loadList(search.q, search.tag).then(setList, (err: unknown) => {
          console.error("notes: reloading the page list failed", err);
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

function Pane({ pages, tags, onFold }: { pages: PageList; tags: TagCount[]; onFold: () => void }): ReactElement {
  const search = notesLayout.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PageSummary | null>(null);
  const filtered = Boolean(search.q || search.tag);

  // The box follows the URL when a link changes it, but not this box's own (delayed) navigation.
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
      const page = await createPage({ tags: search.tag ? [search.tag] : [] });
      await navigate({ to: "/notes/p/$pageId", params: { pageId: page.id }, search: (prev) => prev });
      pagesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className={classes.pane} aria-label="Notes">
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
      {error && <Text c="red">{error}</Text>}
      <form
        role="search"
        aria-label="Search notes"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
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
        <section aria-labelledby="notes-tags-heading">
          <Title order={2} size="h6" id="notes-tags-heading" mb={4}>
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

      <nav aria-labelledby="notes-pages-heading">
        <Group justify="space-between" mb={4} gap="xs">
          <Title order={2} size="h6" id="notes-pages-heading">
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
    </aside>
  );
}

function PageItem({ page, onDelete }: { page: PageSummary; onDelete: () => void }): ReactElement {
  const title = page.title || "Untitled";
  return (
    <li className={classes.pageItem}>
      <AnchorLink
        to="/notes/p/$pageId"
        params={{ pageId: page.id }}
        search={(prev) => prev}
        preload={false}
        className={classes.pageLink}
        activeProps={{ "aria-current": "page" }}
        underline="never"
      >
        {title}
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
function DeleteDialog({ page, onClose }: { page: PageSummary | null; onClose: () => void }): ReactElement {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const [error, setError] = useState<string | null>(null);
  const title = page?.title || "Untitled";

  async function remove() {
    if (!page) return;
    try {
      // Leave the page first, so its editor saves (and stops) before the page is gone.
      if (params.pageId === page.id) await navigate({ to: "/notes", search: (prev) => prev });
      await deletePage(page.id);
      setError(null);
      onClose();
      pagesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal opened={page !== null} onClose={onClose} lockScroll={false} title="Delete this page?">
      <Text size="sm" mb="md">
        “{title}” will be deleted. Links to it from other pages will show as broken.
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
