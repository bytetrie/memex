// /notes with no page open.

import { Text, Title } from "@mantine/core";
import { createRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { notesLayout } from "./layout.tsx";

export const notesIndexRoute = createRoute({
  getParentRoute: () => notesLayout,
  path: "/",
  component: function NotesIndex(): ReactElement {
    return (
      <>
        <Title order={1}>Notes</Title>
        <Text c="dimmed">
          Open a page from the list, or start a new one. In a page, type / for blocks, [[ to link a page and (( to link a block.
        </Text>
      </>
    );
  },
});
