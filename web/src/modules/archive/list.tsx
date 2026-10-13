// /archive: search box and type filter, recent additions and searches (when
// nothing is filtered) or results, and the "Add" menu listing the types.
// The filter lives in the URL (validated search params), so results are linkable.

import { ActionIcon, Button, Chip, Container, Group, Menu, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { createRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactElement, type SubmitEvent } from "react";
import { z } from "zod";
import { ArchiveTypeIdSchema } from "../../../../src/shared/archive-types.ts";
import { deleteSearch, getRecentSearches, listEntries, listJobs, recordSearch } from "../../api.ts";
import { Icon } from "../../icons/Icon.tsx";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import classes from "./Archive.module.css";
import { EntryCard } from "./EntryCard.tsx";
import { JobList, useJobs } from "./JobList.tsx";
import { archiveLayout } from "./layout.tsx";
import { archiveTypeEntries, archiveTypeUi } from "./types/index.ts";

const SearchSchema = z.object({
  q: z.string().optional(),
  type: ArchiveTypeIdSchema.optional(),
  cursor: z.string().optional(),
});

export const listRoute = createRoute({
  getParentRoute: () => archiveLayout,
  path: "/",
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const filtered = Boolean(deps.q || deps.type);
    const [list, recent, jobs] = await Promise.all([listEntries({ ...deps, limit: 20 }), filtered ? null : getRecentSearches(), listJobs()]);
    return { list, recent, filtered, jobs };
  },
  component: function ArchivePage(): ReactElement {
    const { list, recent, filtered, jobs: initialJobs } = listRoute.useLoaderData();
    const search = listRoute.useSearch();
    const navigate = listRoute.useNavigate();
    const router = useRouter();
    // A job that finishes adds an entry: reload the list to show it.
    const { jobs, refresh } = useJobs(initialJobs, () => void router.invalidate());
    const [q, setQ] = useState(search.q ?? "");
    // Links (a tag, a recent search) change the URL while this page stays mounted, so the box has to
    // follow them. It must not follow this form's own navigation: that can land after the person has
    // typed more, and would overwrite it.
    const submitted = useRef(search.q ?? "");
    useEffect(() => {
      const fromUrl = search.q ?? "";
      if (fromUrl === submitted.current) return;
      submitted.current = fromUrl;
      setQ(fromUrl);
    }, [search.q]);

    async function submit(e: SubmitEvent) {
      e.preventDefault();
      const query = q.trim();
      submitted.current = query;
      if (query) await recordSearch({ query, type: search.type }).catch(() => undefined);
      await navigate({ search: { q: query || undefined, type: search.type } });
    }

    return (
      <Container size="md">
        <div className={classes.header}>
          <Title order={1}>Archive</Title>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button leftSection={<Icon name="plus" />}>Add</Button>
            </Menu.Target>
            <Menu.Dropdown>
              {archiveTypeEntries.map(([id, ui]) => (
                <Menu.Item key={id} onClick={() => void navigate({ to: "/archive/new/$type", params: { type: id } })} leftSection={<Icon name={ui.icon} />}>
                  {ui.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>

        <form role="search" aria-label="Search the archive" onSubmit={(e) => void submit(e)}>
          <div className={classes.searchRow}>
            <TextInput
              className={classes.searchField}
              label="Search"
              description="Words, and #tags to narrow down: #work #2026 finds entries with both tags"
              placeholder="Title, text, #tag"
              value={q}
              onChange={(e) => { setQ(e.currentTarget.value); }}
            />
            <Button type="submit" leftSection={<Icon name="search" />}>
              Search
            </Button>
          </div>
          <Chip.Group
            multiple={false}
            value={search.type ?? "all"}
            onChange={(value) => void navigate({ search: { q: search.q, type: value === "all" ? undefined : ArchiveTypeIdSchema.parse(value) } })}
          >
            <Group gap="xs" mt="sm" role="radiogroup" aria-label="Filter by type">
              <Chip value="all">All types</Chip>
              {archiveTypeEntries.map(([id, ui]) => (
                <Chip key={id} value={id}>
                  {ui.label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </form>

        {jobs.length > 0 && (
          <section className={classes.section} aria-labelledby="jobs-heading">
            <Title order={2} size="h3" id="jobs-heading" mb="sm">
              Being added
            </Title>
            <JobList jobs={jobs} onChange={refresh} label="Jobs" />
          </section>
        )}

        <section className={classes.section} aria-labelledby="entries-heading">
          <Title order={2} size="h3" id="entries-heading" mb="sm">
            {filtered ? "Results" : "Recent additions"}
          </Title>
          {list.items.length === 0 ? (
            <Text c="dimmed">{filtered ? "Nothing matches." : "The archive is empty. Use Add to put something in."}</Text>
          ) : (
            <ul className={classes.list}>
              {list.items.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          <Group mt="sm" gap="md">
            {search.cursor && (
              <AnchorLink to="/archive" search={{ ...search, cursor: undefined }}>
                Newest
              </AnchorLink>
            )}
            {list.nextCursor && (
              <AnchorLink to="/archive" search={{ ...search, cursor: list.nextCursor }}>
                Older
              </AnchorLink>
            )}
          </Group>
        </section>

        {recent && (
          <section className={classes.section} aria-labelledby="searches-heading">
            <Title order={2} size="h3" id="searches-heading" mb="sm">
              Recent searches
            </Title>
            {recent.items.length === 0 ? (
              <Text c="dimmed">No searches yet.</Text>
            ) : (
              <ul className={classes.list}>
                {recent.items.map((s) => (
                  <li key={`${s.query}|${s.type ?? ""}`}>
                    <Group gap="xs">
                      <AnchorLink to="/archive" search={{ q: s.query, type: s.type ?? undefined }}>
                        {s.query}
                      </AnchorLink>
                      {s.type && (
                        <Text span size="sm" c="dimmed">
                          in {archiveTypeUi[s.type].label.toLowerCase()}
                        </Text>
                      )}
                      <Tooltip label="Remove from recent searches" openDelay={300}>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          aria-label={`Remove search ${s.query}`}
                          onClick={() => void deleteSearch({ query: s.query, type: s.type ?? undefined }).then(() => router.invalidate())}
                        >
                          <Icon name="trash" size={12} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </Container>
    );
  },
});
