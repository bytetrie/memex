// Applies migrations to the test database once per run.

import { connectTestDb } from "./test-db.ts";
import { runMigrations } from "../db/migrate.ts";

export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) return; // unit tests still run; integration tests fail with a clear message
  const { db, close } = connectTestDb();
  try {
    await runMigrations(db);
  } finally {
    await close();
  }
}
