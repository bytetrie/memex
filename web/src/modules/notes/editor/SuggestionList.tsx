// The popup list of the suggestion menus (/, [[, (( in suggestions.ts): a listbox driven from the
// editor's keyboard (arrows, Enter, Escape), so the cursor stays in the text while choosing.

import { Text, UnstyledButton } from "@mantine/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactElement } from "react";
import { Icon } from "../../../icons/Icon.tsx";
import type { IconName } from "../../../icons/names.ts";
import classes from "./Editor.module.css";

export type MenuItem = { key: string; label: string; hint?: string; icon?: IconName };

export type SuggestionListProps = {
  label: string;
  items: MenuItem[];
  loading: boolean;
  empty: string;
  command: (item: MenuItem) => void;
};

export type SuggestionListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList({ label, items, loading, empty, command }, ref): ReactElement {
  const [index, setIndex] = useState(0);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    setIndex(0);
  }, [items]);
  // Keep the chosen item in view while moving through a list longer than the popup.
  useEffect(() => {
    options.current[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowDown") {
        setIndex((i) => (items.length ? (i + 1) % items.length : 0));
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item) command(item);
        return item !== undefined;
      }
      return false;
    },
  }));

  return (
    <div className={classes.menu}>
      <div role="listbox" aria-label={label}>
        {items.map((item, i) => (
          <UnstyledButton
            key={item.key}
            ref={(el) => {
              options.current[i] = el;
            }}
            role="option"
            aria-selected={i === index}
            className={classes.menuItem}
            // mousedown, not click: keeps the editor's selection
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
            onMouseEnter={() => {
              setIndex(i);
            }}
          >
            {item.icon && <Icon name={item.icon} />}
            <span className={classes.menuLabel}>
              <Text span size="sm">
                {item.label}
              </Text>
              {item.hint && (
                <Text span size="xs" c="dimmed" className={classes.menuHint}>
                  {item.hint}
                </Text>
              )}
            </span>
          </UnstyledButton>
        ))}
      </div>
      {items.length === 0 && (
        <Text size="sm" c="dimmed" p="xs">
          {loading ? "Searching…" : empty}
        </Text>
      )}
    </div>
  );
});
