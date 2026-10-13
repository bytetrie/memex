// Add a "text" entry: the server saves the text as content.md.

import { Button, Stack, Textarea, TextInput } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { TEXT_MAX_LENGTH } from "../../../../../../src/shared/archive-types.ts";
import { createEntry } from "../../../../api.ts";
import { Icon } from "../../../../icons/Icon.tsx";

export function TextAddForm() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (text.trim() === "") {
      setError("Write some text first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await createEntry({ type: "text", title: title.trim() || undefined, input: { text } });
      await navigate({ to: "/archive/e/$entryId", params: { entryId: entry.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Add text">
      <Stack gap="md" maw={720}>
        <Textarea
          label="Text"
          description="Plain text or Markdown"
          autosize
          minRows={8}
          maxLength={TEXT_MAX_LENGTH}
          value={text}
          onChange={(e) => { setText(e.currentTarget.value); }}
          error={error}
        />
        <TextInput label="Title" description="Defaults to the first line" value={title} onChange={(e) => { setTitle(e.currentTarget.value); }} />
        <Button type="submit" loading={busy} leftSection={<Icon name="plus" />}>
          Add to archive
        </Button>
      </Stack>
    </form>
  );
}
