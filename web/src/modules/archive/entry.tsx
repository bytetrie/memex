// /archive/e/$entryId: one entry. Title and tags are editable, files are shown
// by the type's View (or the generic one), and an entry that other modules
// use can't be deleted.

import { Anchor, Badge, Button, Container, Group, TagsInput, Text, TextInput, Title } from "@mantine/core";
import { createRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState, type ReactElement, type SubmitEvent } from "react";
import { z } from "zod";
import type { ArchiveFile } from "../../../../src/shared/archive.ts";
import { isTextMime } from "../../../../src/shared/mime.ts";
import { deleteEntry, getEntry, getFileText, patchEntry } from "../../api.ts";
import { Icon } from "../../icons/Icon.tsx";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import classes from "./Archive.module.css";
import { formatDate } from "./format.ts";
import { GenericView } from "./GenericView.tsx";
import { archiveLayout } from "./layout.tsx";
import { archiveTypeUi } from "./types/index.ts";

const PREVIEW_BYTES = 64 * 1024;
const previewable = (f: ArchiveFile) => isTextMime(f.mime) && f.size > 0; // shown as text, never rendered

export const entryRoute = createRoute({
  getParentRoute: () => archiveLayout,
  path: "e/$entryId",
  params: {
    parse: (raw) => {
      const entryId = z.uuid().safeParse(raw.entryId);
      if (!entryId.success) throw notFound();
      return { entryId: entryId.data };
    },
  },
  loader: async ({ params }) => {
    const entry = await getEntry(params.entryId);
    if (!entry) throw notFound();
    const previews: Record<string, string> = {};
    for (const file of entry.files.filter(previewable).slice(0, 5)) previews[file.name] = await getFileText(entry.id, file.name, PREVIEW_BYTES);
    return { entry, previews };
  },
  component: function EntryPage(): ReactElement {
    const { entry, previews } = entryRoute.useLoaderData();
    const router = useRouter();
    const [title, setTitle] = useState(entry.title);
    const [tags, setTags] = useState(entry.tags);
    const [status, setStatus] = useState<{ kind: "saved" | "error"; message: string } | null>(null);
    const [confirming, setConfirming] = useState(false);
    const View = archiveTypeUi[entry.type].View ?? GenericView;

    async function save(e: SubmitEvent) {
      e.preventDefault();
      try {
        await patchEntry(entry.id, { title: title.trim(), tags });
        setStatus({ kind: "saved", message: "Saved." });
        await router.invalidate();
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    async function remove() {
      try {
        await deleteEntry(entry.id);
        await router.navigate({ to: "/archive" });
      } catch (err) {
        setConfirming(false);
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    return (
      <Container size="md">
        <AnchorLink to="/archive" size="sm" aria-label="Back to archive">
          <Icon name="angle-left" /> Archive
        </AnchorLink>
        <Title order={1}>{entry.title}</Title>
        <div className={classes.meta}>
          <Badge variant="light" leftSection={<Icon name={archiveTypeUi[entry.type].icon} />}>
            {archiveTypeUi[entry.type].label}
          </Badge>
          <Text size="sm" c="dimmed">
            Added {formatDate(entry.createdAt)}
          </Text>
          {entry.sourceUrl && (
            <Anchor href={entry.sourceUrl} size="sm" rel="noreferrer noopener" target="_blank">
              Source
            </Anchor>
          )}
        </div>

        <section className={classes.section} aria-labelledby="details-heading">
          <Title order={2} size="h3" id="details-heading" mb="sm">
            Details
          </Title>
          <form onSubmit={(e) => void save(e)} aria-label="Edit details">
            <Group align="flex-end" gap="sm">
              <TextInput label="Title" value={title} onChange={(e) => { setTitle(e.currentTarget.value); }} className={classes.searchField} required />
              <TagsInput label="Tags" value={tags} onChange={setTags} className={classes.searchField} />
              <Button type="submit" leftSection={<Icon name="floppy" />}>
                Save
              </Button>
            </Group>
            {status && (
              <Text size="sm" mt="xs" c={status.kind === "error" ? "red" : "dimmed"} role={status.kind === "error" ? "alert" : "status"}>
                {status.message}
              </Text>
            )}
          </form>
        </section>

        <section className={classes.section} aria-labelledby="files-heading">
          <Title order={2} size="h3" id="files-heading" mb="sm">
            {archiveTypeUi[entry.type].viewHeading ?? "Files"}
          </Title>
          <View entry={entry} previews={previews} />
        </section>

        {Object.keys(entry.meta).length > 0 && (
          <section className={classes.section} aria-labelledby="meta-heading">
            <Title order={2} size="h3" id="meta-heading" mb="sm">
              Metadata
            </Title>
            <pre className={classes.preview}>{JSON.stringify(entry.meta, null, 2)}</pre>
          </section>
        )}

        <section className={classes.section} aria-labelledby="used-heading">
          <Title order={2} size="h3" id="used-heading" mb="sm">
            Used by
          </Title>
          {entry.refs.length === 0 ? (
            <Text c="dimmed">Nothing uses this entry yet.</Text>
          ) : (
            <ul className={classes.list}>
              {entry.refs.map((ref) => (
                <li key={`${ref.module}/${ref.itemId}`}>
                  {ref.module}: {ref.itemId}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={classes.section} aria-labelledby="delete-heading">
          <Title order={2} size="h3" id="delete-heading" mb="sm">
            Delete
          </Title>
          {entry.refs.length > 0 ? (
            <>
              <Button color="red" variant="light" disabled aria-describedby="delete-reason" leftSection={<Icon name="trash" />}>
                Delete entry
              </Button>
              <Text size="sm" c="dimmed" mt="xs" id="delete-reason">
                In use by {entry.refs.length} {entry.refs.length === 1 ? "item" : "items"}; release {entry.refs.length === 1 ? "it" : "them"} first.
              </Text>
            </>
          ) : confirming ? (
            <Group gap="sm">
              <Text>Delete this entry and its files?</Text>
              <Button color="red" onClick={() => void remove()}>
                Confirm delete
              </Button>
              <Button variant="default" onClick={() => { setConfirming(false); }}>
                Cancel
              </Button>
            </Group>
          ) : (
            <Button color="red" variant="light" leftSection={<Icon name="trash" />} onClick={() => { setConfirming(true); }}>
              Delete entry
            </Button>
          )}
        </section>
      </Container>
    );
  },
});
