// Add a "file" entry: text files only. Each file is checked in the browser first, then uploaded,
// then the entry naming them is created (the server checks again).

import { Button, FileInput, Stack, Text, TextInput } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { MAX_FILE_BYTES } from "../../../../../../src/shared/archive-types.ts";
import { createEntry, uploadBlob } from "../../../../api.ts";
import { formatBytes } from "../../format.ts";
import { notTextReason } from "./textCheck.ts";
import { Icon } from "../../../../icons/Icon.tsx";

export function FileAddForm() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Choose at least one file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}, the most the archive takes`);
        const reason = await notTextReason(file);
        if (reason) throw new Error(`${file.name} ${reason}; only text files can be added`);
      }
      const uploaded = [];
      for (const file of files) uploaded.push({ sha256: (await uploadBlob(file)).sha256, name: file.name, mime: file.type || undefined });
      const entry = await createEntry({ type: "file", title: title.trim() || undefined, input: { files: uploaded } });
      await navigate({ to: "/archive/e/$entryId", params: { entryId: entry.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Add text files">
      <Stack gap="md" maw={520}>
        <FileInput
          label="Files"
          description="Text files only (UTF-8): notes, Markdown, JSON, CSV, code, logs, subtitles. Their text is searchable."
          placeholder="Choose files"
          multiple
          clearable
          value={files}
          onChange={(chosen) => {
            setFiles(chosen);
            setError(null);
          }}
        />
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        <TextInput label="Title" description="Defaults to the first file's name" value={title} onChange={(e) => { setTitle(e.currentTarget.value); }} />
        <Button type="submit" loading={busy} leftSection={<Icon name="upload" />}>
          Add to archive
        </Button>
        {busy && (
          <Text size="sm" c="dimmed" role="status">
            Uploading…
          </Text>
        )}
      </Stack>
    </form>
  );
}
