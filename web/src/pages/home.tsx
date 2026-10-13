import { Code, Container, Text, Title } from "@mantine/core";
import { createRoute } from "@tanstack/react-router";
import { getHealth } from "../api.ts";
import { rootRoute } from "../root.tsx";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: getHealth,
  component: function Home() {
    const health = homeRoute.useLoaderData();
    return (
      <Container size="md">
        <Title order={1}>memex</Title>
        <Text c="dimmed" mb="md">
          Pick a component from the sidebar.
        </Text>
        <Title order={2} size="h4">
          API health
        </Title>
        <Code block>{JSON.stringify(health, null, 2)}</Code>
      </Container>
    );
  },
});
