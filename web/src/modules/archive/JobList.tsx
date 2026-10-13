// Background additions (jobs): what is queued, running or failed, with progress and errors.
// useJobs polls every 2 s while a job is queued or running; a job seen running on this page stays
// in the list once it finishes, as a link to its entry (or with its error).

import { Alert, Badge, Button, Code, Group, Progress, Text } from "@mantine/core";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Job, JobStage } from "../../../../src/shared/archive-jobs.ts";
import { cancelJob, dismissJob, listJobs, retryJob } from "../../api.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import classes from "./Archive.module.css";
import { archiveTypeUi } from "./types/index.ts";

const POLL_MS = 2000;
const isActive = (job: Job) => job.status === "queued" || job.status === "running";

export function useJobs(initial: Job[], onFinished?: (job: Job) => void) {
  const [jobs, setJobs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // Jobs seen queued or running here: they stay listed when they finish.
  const watched = useRef(new Set(initial.filter(isActive).map((j) => j.id)));
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const refresh = useCallback(async () => {
    try {
      const all = await listJobs(["queued", "running", "failed", "done", "cancelled"]);
      const shown = all.filter((j) => isActive(j) || j.status === "failed" || watched.current.has(j.id));
      for (const job of shown) {
        if (isActive(job)) watched.current.add(job.id);
      }
      setJobs((before) => {
        for (const job of shown) {
          const was = before.find((b) => b.id === job.id);
          if (was && isActive(was) && !isActive(job)) finished.current?.(job);
        }
        return shown;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // A job queued from this page (the add form) is watched from the start.
  const track = useCallback(
    (job: Job) => {
      watched.current.add(job.id);
      setJobs((before) => [job, ...before.filter((j) => j.id !== job.id)]);
      void refresh();
    },
    [refresh],
  );

  const active = jobs.some(isActive);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => { clearInterval(timer); };
  }, [active, refresh]);

  return { jobs, refresh, track, error };
}

const stageLabel: Record<JobStage, string> = { download: "Downloading", encode: "Converting", import: "Importing" };

function statusText(job: Job): string {
  switch (job.status) {
    case "queued":
      return job.ahead ? `Queued, ${String(job.ahead)} ahead` : "Queued, next";
    case "running":
      return job.stage ? stageLabel[job.stage] : "Starting";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

const statusColor = { queued: "gray", running: "blue", done: "green", failed: "red", cancelled: "gray" } as const;

// What the job is about: the title asked for, else its URL.
export const jobLabel = (job: Job) => job.title ?? (typeof job.input.url === "string" ? job.input.url : archiveTypeUi[job.type].label);

function JobItem({ job, onChange }: { job: Job; onChange: () => Promise<void> }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const label = jobLabel(job);

  async function act(action: (id: string) => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action(job.id);
      await onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={classes.fileItem} aria-label={`Job: ${label}`}>
      <div className={classes.fileHead}>
        <Icon name={archiveTypeUi[job.type].icon} size={18} />
        <Text fw={700} className={classes.jobLabel}>
          {label}
        </Text>
        <Badge variant="light" color={statusColor[job.status]}>
          {statusText(job)}
        </Badge>
      </div>
      {job.status === "running" && (
        <Progress.Root size="lg">
          <Progress.Section
            value={job.progress ?? 100}
            striped={job.progress === null}
            animated={job.progress === null}
            aria-label={`${statusText(job)}: ${job.progress === null ? "in progress" : `${String(Math.round(job.progress))} %`}`}
          />
        </Progress.Root>
      )}
      {job.status === "running" && job.detail && (
        <Text size="sm" c="dimmed">
          {job.detail}
        </Text>
      )}
      {job.status === "failed" && (
        <Alert color="red" title="This job failed">
          {job.error ?? "Unknown error"}
        </Alert>
      )}
      {job.status === "failed" && job.logTail && (
        <details>
          <summary>Log</summary>
          <Code block className={classes.preview}>
            {job.logTail}
          </Code>
        </details>
      )}
      <Group gap="xs">
        {job.status === "done" && job.entryId && (
          <AnchorLink to="/archive/e/$entryId" params={{ entryId: job.entryId }}>
            Open the entry
          </AnchorLink>
        )}
        {isActive(job) && (
          <Button size="xs" variant="default" loading={busy} onClick={() => void act(cancelJob)} aria-label={`Cancel ${label}`}>
            Cancel
          </Button>
        )}
        {(job.status === "failed" || job.status === "cancelled") && (
          <Button size="xs" variant="default" loading={busy} onClick={() => void act(retryJob)} aria-label={`Retry ${label}`}>
            Retry
          </Button>
        )}
        {!isActive(job) && (
          <Button size="xs" variant="subtle" color="gray" loading={busy} onClick={() => void act(dismissJob)} aria-label={`Dismiss ${label}`}>
            Dismiss
          </Button>
        )}
      </Group>
      {actionError && (
        <Text size="sm" c="red" role="alert">
          {actionError}
        </Text>
      )}
    </li>
  );
}

export function JobList({ jobs, onChange, label }: { jobs: Job[]; onChange: () => Promise<void>; label: string }): ReactElement {
  return (
    <ul className={classes.list} aria-label={label}>
      {jobs.map((job) => (
        <JobItem key={job.id} job={job} onChange={onChange} />
      ))}
    </ul>
  );
}
