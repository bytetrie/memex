// Root route: every page renders inside the Shell. Kept apart from router.tsx
// so routes can import it without an import cycle.

import { Container, Text, Title } from "@mantine/core";
import { createRootRoute } from "@tanstack/react-router";
import { Shell } from "./components/Shell.tsx";

export const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <Container size="md">
      <Title order={1}>Not found</Title>
      <Text c="dimmed">Nothing lives at this address.</Text>
    </Container>
  ),
  errorComponent: ({ error }) => (
    <Container size="md">
      <Title order={1}>Something went wrong</Title>
      <Text c="red">{error instanceof Error ? error.message : String(error)}</Text>
    </Container>
  ),
});
