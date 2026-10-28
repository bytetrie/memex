// postgres.js + drizzle. Imported only by server.ts, scripts and tests, never
// by src/server/app.ts (its repo interface lives in archive/ports.ts).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDb(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

export type Db = ReturnType<typeof createDb>["db"];
// The handle a db.transaction() callback gets.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
