// Glyph from the fontello icon font. Names come from web/icons/fontello.json;
// to add one, see AGENTS.md "Icons".

import type { IconName } from "./names.ts";
import "./icons.css";

export function Icon({ name, size }: { name: IconName; size?: number | string }) {
  return <i className={`icon icon-${name}`} style={size === undefined ? undefined : { fontSize: size }} aria-hidden />;
}
