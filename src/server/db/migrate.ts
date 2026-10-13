// Applies the generated SQL migrations in drizzle/. Run by server.ts at boot,
// by `pnpm db:migrate`, and by the test setup.

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export const runMigrations = (db: Db) => migrate(db, { migrationsFolder });
