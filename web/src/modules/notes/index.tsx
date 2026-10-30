// /notes with no page open: reopens the page last viewed in this browser, if there is one.

import { Text, Title } from "@mantine/core";
import { createRoute, redirect } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { lastPage } from "./lastPage.ts";
import { notesLayout } from "./layout.tsx";

export const notesIndexRoute = createRoute({
  getParentRoute: () => notesLayout,
  path: "/",
  beforeLoad: ({ search }) => {
    const pageId = lastPage();
    if (pageId) throw redirect({ to: "/notes/p/$pageId", params: { pageId }, search, replace: true });
  },
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
