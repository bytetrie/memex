// App frame: thin icon sidebar on the left (tooltip shows the name), the
// active route renders in the main area.

import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Icon } from "../icons/Icon.tsx";
import { nav } from "../nav.ts";
import classes from "./Shell.module.css";

export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className={classes.root}>
      <nav className={classes.sidebar} aria-label="App components">
        <Stack gap={6} align="center">
          {nav.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Tooltip key={item.to} label={item.label} position="right" withArrow openDelay={150}>
                <ActionIcon
                  component={Link}
                  to={item.to}
                  size={44}
                  radius="md"
                  variant={active ? "light" : "subtle"}
                  color={active ? undefined : "gray"}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={item.icon} size={20} />
                </ActionIcon>
              </Tooltip>
            );
          })}
        </Stack>
      </nav>
      <main className={classes.main}>
        <Outlet />
      </main>
    </div>
  );
}
