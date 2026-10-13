// zod probes for eval support with `Function("")` when the first schema is
// built; the CSP blocks it and the browser reports a violation. Jitless mode
// skips the probe. Imported first in main.tsx so it runs before any schema.

import { z } from "zod";

z.config({ jitless: true });
