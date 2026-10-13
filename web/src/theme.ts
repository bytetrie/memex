// Mantine theme. Also imported by vite.config.ts to render the static CSS
// variables, so keep it plain data (no DOM access, no CSS imports).
// Fonts are declared in ./fonts.css.

import { createTheme } from "@mantine/core";

const sans = "'TeX Gyre Heros', Helvetica, Arial, sans-serif";

export const theme = createTheme({
  primaryColor: "indigo",
  fontFamily: sans,
});
