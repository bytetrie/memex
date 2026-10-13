// drizzle-kit only generates SQL from schema.ts (`pnpm db:generate`); it never
// touches a database. Migrations are applied by src/server/db/migrate.ts.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  casing: "snake_case", // must match createDb(): a column declared without a name becomes snake_case
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
