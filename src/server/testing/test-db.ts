// The test database, guarded: never connects to anything but a *_test database.

import { sql } from "drizzle-orm";
import { createDb, type Db } from "../db/client.ts";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see ~/.config/devstack/memex.env)");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`refusing to run tests against database "${name}": its name must end in _test`);
  return url;
}

export const connectTestDb = () => createDb(testDatabaseUrl());

// Empties every table in `public` (new tables are picked up automatically).
export async function truncateAll(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}
