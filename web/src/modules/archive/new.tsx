// /archive/new/$type: the add form of the chosen type.

import { Container, Title } from "@mantine/core";
import { createRoute, notFound } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { ArchiveTypeIdSchema } from "../../../../src/shared/archive-types.ts";
import { AnchorLink } from "../../components/AnchorLink.tsx";
import { Icon } from "../../icons/Icon.tsx";
import { archiveLayout } from "./layout.tsx";
import { archiveTypeUi } from "./types/index.ts";

export const newRoute = createRoute({
  getParentRoute: () => archiveLayout,
  path: "new/$type",
  params: {
    parse: (raw) => {
      const type = ArchiveTypeIdSchema.safeParse(raw.type);
      if (!type.success) throw notFound();
      return { type: type.data };
    },
  },
  component: function NewEntryPage(): ReactElement {
    const { type } = newRoute.useParams();
    const { label, AddForm } = archiveTypeUi[type];
    return (
      <Container size="md">
        <AnchorLink to="/archive" size="sm" aria-label="Back to archive">
          <Icon name="angle-left" /> Archive
        </AnchorLink>
        <Title order={1} mb="lg">
          Add {label.toLowerCase()}
        </Title>
        <AddForm />
      </Container>
    );
  },
});
