// Helpers for the drizzle repos (src/server/archive/repo.ts, src/server/notes/repo.ts).

// drizzle wraps driver errors; the Postgres SQLSTATE sits on the error or its cause.
export function pgCode(err: unknown): string | undefined {
  for (let e = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
export const FOREIGN_KEY = "23503";
export const UNIQUE = "23505";

export const iso = (d: Date) => d.toISOString();

// The row a statement always returns (INSERT ... RETURNING, a row read back right after writing it).
export function single<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected a row, the statement returned none");
  return row;
}
export const uniqueSorted = (tags: string[]) => [...new Set(tags)].sort();
