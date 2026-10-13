// pnpm test. Integration tests use the empty database memex_test
// (TEST_DATABASE_URL, from the environment or ~/.config/devstack/memex.env);
// the setup refuses to touch a database whose name does not end in _test.
// Files run one after another because they share that database.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file in the user's home
    return parseEnv(readFileSync(join(homedir(), ".config/devstack/memex.env"), "utf8")).TEST_DATABASE_URL ?? "";
  } catch {
    return "";
  }
}

// Set here (not only in test.env, which reaches the test workers) so globalSetup sees it too and
// migrates the database.
process.env.TEST_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["src/server/testing/global-setup.ts"],
  },
});
