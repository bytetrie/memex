// /notes/p/$pageId: one page. Title and tags above the editor, backlinks below. (Deleting a page
// is in the pane's menu, layout.tsx.)
//
// The editor (editor/Editor.tsx, with Tiptap) is a lazy chunk and owns the doc; this component
// never re-renders it: typing in the title updates only the title field and the autosave, and
// the editor is memoised. The page's data is always fetched fresh when the page is opened
// (gcTime 0, no preloading): an editor started from a stale doc would conflict on its first save.

import { Alert, Button, Group, TagsInput, Text, TextInput, Title } from "@mantine/core";
import { createRoute, notFound, useRouter } from "@tanstack/react-router";
import { lazy, memo, Suspense, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { z } from "zod";
import type { Backlink, Page } from "../../../../src/shared/notes.ts";
import { getBacklinks, getPage, savePage, setPageTags } from "../../api.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import { createAutosave, type Autosave } from "./autosave.ts";
import { pagesChanged } from "./events.ts";
import { notesLayout } from "./layout.tsx";
import classes from "./Notes.module.css";

const Editor = memo(lazy(() => import("./editor/Editor.tsx")));

export const pageRoute = createRoute({
  getParentRoute: () => notesLayout,
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
    const [page, backlinks] = await Promise.all([getPage(params.pageId), getBacklinks(params.pageId)]);
    if (!page) throw notFound();
    return { page, backlinks };
  },
  component: function PageRoute(): ReactElement {
    const { page, backlinks } = pageRoute.useLoaderData();
    // Bumped to start over from the server's version after a conflict.
    const [generation, setGeneration] = useState(0);
    return <PageView key={`${page.id}:${String(generation)}`} page={page} backlinks={backlinks} onReload={() => { setGeneration((g) => g + 1); }} />;
  },
});

function SaveStatus({ autosave, onReload }: { autosave: Autosave; onReload: () => Promise<void> }): ReactElement {
  const state = useSyncExternalStore(autosave.subscribe, autosave.getState);
  if (state.status === "conflict") {
    return (
      <Alert color="orange" title="This page was changed elsewhere" mt="sm">
        <Text size="sm" mb="xs">
          Another tab or device saved this page while you were editing it. Your changes here are not saved yet.
        </Text>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={() => void onReload()}>
            Load the saved version
          </Button>
          <Button size="xs" color="orange" onClick={() => void autosave.overwrite()}>
            Keep mine
          </Button>
        </Group>
      </Alert>
    );
  }
  const text = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: `Not saved: ${state.status === "error" ? (state.error ?? "") : ""} (retrying)` }[state.status];
  return (
    <Text size="sm" c={state.status === "error" ? "red" : "dimmed"} aria-live="polite">
      {text}
    </Text>
  );
}

// One entry per linking page; under it, each place on that page that links here (its block's
// text), opening that page at that block.
function Backlinks({ items }: { items: Backlink[] }): ReactElement {
  const byPage = new Map<string, { title: string; refs: Backlink[] }>();
  for (const b of items) {
    const group = byPage.get(b.pageId) ?? { title: b.pageTitle, refs: [] };
    // A block linking here twice is one place.
    if (!group.refs.some((r) => r.blockId === b.blockId)) group.refs.push(b);
    byPage.set(b.pageId, group);
  }
  return (
    <section className={classes.section} aria-labelledby="backlinks-heading">
      <Title order={2} size="h5" id="backlinks-heading" mb="xs">
        Linked from
      </Title>
      {byPage.size === 0 ? (
        <Text c="dimmed" size="sm">
          No other page links here yet.
        </Text>
      ) : (
        <ul className={classes.backlinks}>
          {[...byPage].map(([pageId, { title, refs }]) => (
            <li key={pageId}>
              <AnchorLink to="/notes/p/$pageId" params={{ pageId }} search={(prev) => prev} preload={false} size="sm" fw={500}>
                {title || "Untitled"}
              </AnchorLink>
              {refs.some((r) => r.blockId) && (
                <ul className={classes.backlinkRefs} aria-label={`Where ${title || "Untitled"} links here`}>
                  {refs
                    .filter((r) => r.blockId)
                    .map((r, i) => (
                      <li key={`${r.blockId ?? ""}-${String(i)}`}>
                        <AnchorLink
                          to="/notes/p/$pageId"
                          params={{ pageId }}
                          hash={r.blockId ?? undefined}
                          search={(prev) => prev}
                          preload={false}
                          className={classes.backlinkRef}
                          underline="hover"
                        >
                          {r.text.trim() || "(a block without text)"}
                        </AnchorLink>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PageView({ page, backlinks, onReload }: { page: Page; backlinks: Backlink[]; onReload: () => void }): ReactElement {
  const router = useRouter();
  const autosave = useMemo(
    () =>
      createAutosave({
        version: page.version,
        title: page.title,
        save: (input, opts) => savePage(page.id, input, opts),
        onSaved: pagesChanged,
      }),
    [], // one autosave per page view: the key in PageRoute replaces this component for another page
  );
  const [title, setTitle] = useState(page.title);
  const [tags, setTags] = useState(page.tags);
  const [tagError, setTagError] = useState<string | null>(null);

  async function changeTags(next: string[]) {
    setTags(next);
    try {
      const saved = await setPageTags(page.id, next);
      setTags(saved.tags);
      setTagError(null);
      pagesChanged();
    } catch (err) {
      setTagError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reload() {
    await router.invalidate({ filter: (m) => m.routeId === pageRoute.id });
    onReload();
  }

  return (
    <article className={classes.page} aria-labelledby="page-title">
      <div className={classes.pageHead}>
        <TextInput
          id="page-title"
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
        mb="sm"
        leftSection={<Icon name="tag" />}
      />

      <Suspense fallback={<Text c="dimmed">Loading the editor…</Text>}>
        <Editor page={page} autosave={autosave} />
      </Suspense>

      <Backlinks items={backlinks} />

    </article>
  );
}
