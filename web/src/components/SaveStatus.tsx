// A page's save state beside its title: Saved / Saving… / an error (retrying), or, after a
// conflict, the choice between the saved version and this one. Reads the autosave
// (web/src/autosave.ts) through useSyncExternalStore, so only this component re-renders for it.

import { Alert, Button, Group, Text } from "@mantine/core";
import { useSyncExternalStore, type ReactElement } from "react";
import type { Autosave } from "../autosave.ts";

export function SaveStatus<D>({ autosave, onReload }: { autosave: Autosave<D>; onReload: () => Promise<void> }): ReactElement {
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
