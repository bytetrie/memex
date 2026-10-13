// Playwright drives Debian's Chromium (infra/apt-packages.txt), not a browser
// downloaded by `playwright install`. Tests run against the app through Caddy,
// so they see the real CSP headers; build first (pnpm build).
// usage: pnpm test:e2e   (BASE_URL=... to target another origin)

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL: process.env.BASE_URL ?? "https://app.memex",
    // Caddy's local CA is not in Chromium's trust store inside the container.
    ignoreHTTPSErrors: true,
    launchOptions: { executablePath: "/usr/bin/chromium" },
  },
});
