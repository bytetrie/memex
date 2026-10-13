// Applies pending migrations to DATABASE_URL (the same role the app uses).
// usage: pnpm db:migrate

import { createDb } from "../src/server/db/client.ts";
import { runMigrations } from "../src/server/db/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (pnpm db:migrate loads ~/.config/devstack/memex.env)");
const { db, close } = createDb(url);
try {
  await runMigrations(db);
  console.log("migrations applied");
} finally {
  await close();
}
