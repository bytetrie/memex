// Sidebar entries, top to bottom. Each `to` must be a registered route (checked
// by tsc), and each `icon` a glyph in the icon font.

import type { LinkProps } from "@tanstack/react-router";
import type { IconName } from "./icons/names.ts";

export type NavItem = { to: NonNullable<LinkProps["to"]>; label: string; icon: IconName };

export const nav: NavItem[] = [
  { to: "/notes", label: "Notes", icon: "doc-text" },
  { to: "/archive", label: "Archive", icon: "box" },
  { to: "/chat", label: "Chat", icon: "chat" },
  { to: "/memex", label: "Memex", icon: "sitemap" },
  { to: "/external", label: "External", icon: "link-ext" },
];
