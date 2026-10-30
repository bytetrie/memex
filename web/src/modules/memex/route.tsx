// Memex: printable pages built by hand, printed or exported (design: ideas/printable.md).
// The print view is its own route under the root (no pane), at /memex/print.

import { memexIndexRoute } from "./index.tsx";
import { memexLayout } from "./layout.tsx";
import { memexPageRoute } from "./page.tsx";

export { memexPrintRoute } from "./output/PrintView.tsx";
export const memexRoute = memexLayout.addChildren([memexIndexRoute, memexPageRoute]);
