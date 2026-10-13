// Add a "video": a page URL that the server fetches in the background (a job). The form stays
// usable, so several videos can be queued; the jobs below it show progress, errors and, once
// done, a link to the entry.

import { Button, Stack, TagsInput, Text, TextInput, Title } from "@mantine/core";
import { useEffect, useState, type ReactElement, type SubmitEvent } from "react";
import { isFetchableUrl } from "../../../../../../src/shared/archive-types.ts";
import { createJob, DuplicateError } from "../../../../api.ts";
import { AnchorLink } from "../../../../components/AnchorLink.tsx";
import { Icon } from "../../../../icons/Icon.tsx";
import { JobList, useJobs } from "../../JobList.tsx";

export function VideoAddForm(): ReactElement {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateError | null>(null);
  const [busy, setBusy] = useState(false);
  const { jobs, refresh, track, error: pollError } = useJobs([]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const value = url.trim();
    setDuplicate(null);
    if (!isFetchableUrl(value)) {
      setError("Enter the video page's https:// address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await createJob({ type: "video", title: title.trim() || undefined, tags: tags.length ? tags : undefined, input: { url: value } });
      track(job);
      setUrl("");
      setTitle("");
      setTags([]);
    } catch (err) {
      if (err instanceof DuplicateError) setDuplicate(err);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const videoJobs = jobs.filter((j) => j.type === "video");

  return (
    <Stack gap="xl" maw={720}>
      <form onSubmit={(e) => void submit(e)} aria-label="Add video" noValidate>
        <Stack gap="md">
          <TextInput
            label="Video page URL"
            description="YouTube, Vimeo and the many other sites yt-dlp knows. Downloaded at up to 1080p, with English subtitles when there are any."
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
            required
            value={url}
            onChange={(e) => { setUrl(e.currentTarget.value); }}
            error={error}
          />
          <TextInput label="Title" description="Defaults to the video's title" value={title} onChange={(e) => { setTitle(e.currentTarget.value); }} />
          <TagsInput label="Tags" value={tags} onChange={setTags} />
          <Button type="submit" loading={busy} leftSection={<Icon name="plus" />}>
            Queue download
          </Button>
          {duplicate && (
            <Text role="alert" c="orange">
              {duplicate.entryId ? (
                <>
                  This video is already archived:{" "}
                  <AnchorLink to="/archive/e/$entryId" params={{ entryId: duplicate.entryId }}>
                    open it
                  </AnchorLink>
                  .
                </>
              ) : (
                <>This video is already in the queue below.</>
              )}
            </Text>
          )}
        </Stack>
      </form>

      <section aria-labelledby="video-jobs-heading">
        <Title order={2} size="h3" id="video-jobs-heading" mb="sm">
          Downloads
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Videos are fetched one at a time, in order. You can leave this page; the archive page lists them too.
        </Text>
        {pollError && (
          <Text size="sm" c="red" role="alert" mb="sm">
            Could not load the downloads: {pollError}
          </Text>
        )}
        {videoJobs.length === 0 ? (
          <Text c="dimmed">Nothing queued.</Text>
        ) : (
          <JobList jobs={videoJobs} onChange={refresh} label="Video downloads" />
        )}
      </section>
    </Stack>
  );
}
