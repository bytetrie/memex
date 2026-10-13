// Small node-free types shared by app.ts and what server.ts passes into it.

// The subset of pino's API the app uses, so app.ts needs no logging library.
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

// Hono environment of every route: the per-request logger (carries reqId).
export type AppEnv = { Variables: { log: Logger } };
