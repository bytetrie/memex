// Placeholder page used by every sidebar component until it gets its own UI.

import { Card, Container, Text, Title } from "@mantine/core";
import type { Module } from "../../../src/shared/api.ts";
import classes from "./ModulePage.module.css";

export function ModulePage({ module }: { module: Module }) {
  return (
    <Container size="md">
      <Title order={1}>{module.title}</Title>
      <Text c="dimmed" mb="lg">
        {module.description}
      </Text>
      <div className={classes.items}>
        {module.items.map((item) => (
          <Card key={item.id} withBorder padding="md">
            <Text fw={700}>{item.title}</Text>
            <Text size="sm" c="dimmed">
              {item.summary}
            </Text>
          </Card>
        ))}
      </div>
    </Container>
  );
}
