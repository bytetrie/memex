// /memex with no page open.

import { Text, Title } from "@mantine/core";
import { createRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { memexLayout } from "./layout.tsx";

export const memexIndexRoute = createRoute({
  getParentRoute: () => memexLayout,
  path: "/",
  component: function MemexIndex(): ReactElement {
    return (
      <>
        <Title order={1}>Memex</Title>
        <Text c="dimmed" maw={640}>
          Printable pages: US Letter, Half or Quarter Letter, built from text boxes, images, SVGs and drawings pasted from Excalidraw. Open a page from the list or start a new one;
          Print or export prints a sequence of pages, one per sheet or as copies on Letter, saves it as a PDF from the print dialog, or downloads it as an HTML file.
        </Text>
      </>
    );
  },
});
