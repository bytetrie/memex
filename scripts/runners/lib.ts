// Plumbing shared by the runners (AGENTS.md "Runners"): stdin and stdout are the TCP connection.
// serve() reads one request line, hands it to the job, writes the job's events as JSON lines and
// ends with `done` or `error`. Logs go to stderr (the journal), never to stdout.
//
// Hang-up: the app cancels a job by closing the connection. stdin reaching EOF is not that signal
// (a test or `printf ... | nc` closes its sending side after the request), so the runner notices a
// closed connection when a write fails; heartbeats make sure it writes every few seconds. Then the
// job's AbortSignal fires and its processes are killed.

import { randomBytes } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { z } from "zod";
import { start } from "../../src/server/node/child-process.ts";
import { JobDirSchema, MAX_LINE_BYTES, type ProgressEvent } from "../../src/shared/runners.ts";

const HEARTBEAT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

export type JobIo = {
  progress(event: Omit<ProgressEvent, "event">): void;
  log(line: string): void;
  signal: AbortSignal;
};

export function incomingDir(): string {
  const dir = process.env.INCOMING_DIR;
  if (!dir) throw new Error("INCOMING_DIR is not set");
  return dir;
}

// The environment for tools a runner starts: just enough to run, nothing inherited.
export function toolEnv(home: string): Record<string, string> {
  return { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, LANG: "C.UTF-8", TZ: "UTC" };
}

// Folders and files a runner (or a tool it starts) creates must be group-writable, so the app
// (group memex-data) can read and delete them after importing. That comes from the umask, not
// chmod: the unit's RestrictSUIDSGID=yes refuses any chmod that sets the setgid bit (EPERM), and a
// plain 770 would clear it. incoming/ is setgid, so the kernel gives every new folder in it the
// setgid bit and the memex-data group by itself: 2770 folders, 0660 files.
const GROUP_WRITABLE_UMASK = 0o007;

// A new job folder in $INCOMING_DIR, with a random name.
export async function makeJobDir(): Promise<{ name: string; path: string }> {
  for (let attempt = 0; ; attempt++) {
    const name = `job-${randomBytes(6).toString("base64url")}`;
    const path = join(incomingDir(), name);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a random name directly inside INCOMING_DIR
      await mkdir(path, { mode: 0o770 });
      return { name, path };
    } catch (err) {
      if (attempt < 5 && err instanceof Error && "code" in err && err.code === "EEXIST") continue;
      throw err;
    }
  }
}

// A folder inside a job folder (2770 like the job folder itself).
export async function makeSubdir(path: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- callers pass fixed names inside a job folder
  await mkdir(path, { recursive: true, mode: 0o770 });
}

// An existing job folder named by a request: a folder directly inside $INCOMING_DIR, not a link.
export async function openJobDir(name: string): Promise<string> {
  const dir = JobDirSchema.parse(name);
  const path = join(incomingDir(), dir);
  if (dirname(path) !== incomingDir()) throw new Error("job folder outside INCOMING_DIR");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- JobDirSchema allows no separators or dots, checked above
  const st = await lstat(path).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`no job folder ${dir}`);
  return path;
}

export async function removeJobDir(path: string): Promise<void> {
  if (dirname(path) !== incomingDir()) return;
  await rm(path, { recursive: true, force: true });
}

export type ToolResult = { code: number | null; signal: string | null; stderrTail: string[] };

// Runs a tool to completion, handing each line of its stdout and stderr to the callbacks. Keeps the
// last 50 stderr lines for error messages. The job's signal kills it (SIGTERM).
export function runTool(
  command: string,
  args: readonly string[],
  opts: { cwd: string; env: Record<string, string>; signal: AbortSignal; onStdout?: (line: string) => void; onStderr?: (line: string) => void },
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = start(command, args, { cwd: opts.cwd, env: opts.env, signal: opts.signal });
    const stderrTail: string[] = [];
    if (child.stdout) createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => opts.onStdout?.(line));
    if (child.stderr) {
      createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
        opts.onStderr?.(line);
      });
    }
    child.on("error", (err) => {
      // An abort surfaces as an error too; report it as a killed process.
      if (opts.signal.aborted) resolve({ code: null, signal: "SIGTERM", stderrTail });
      else reject(err);
    });
    child.on("close", (code, signal) => { resolve({ code, signal, stderrTail }); });
  });
}

// Reads the first line from stdin (the request), at most MAX_LINE_BYTES.
function readRequestLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => { done(new Error("no request within 30 s")); }, REQUEST_TIMEOUT_MS);
    const done = (err: Error | null, line?: string) => {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      if (err) reject(err);
      else resolve(line ?? "");
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) done(null, buf.slice(0, nl));
      else if (buf.length > MAX_LINE_BYTES) done(new Error("request line too long"));
    };
    const onEnd = () => {
      if (buf.trim()) done(null, buf);
      else done(new Error("no request"));
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

// Runs one job: `job` validates the request with `schema` and returns the `done` event.
export async function serve<S extends z.ZodType>(name: string, schema: S, job: (request: z.output<S>, io: JobIo) => Promise<object>): Promise<void> {
  process.umask(GROUP_WRITABLE_UMASK); // inherited by every tool the job starts
  const abort = new AbortController();
  let lastWrite = Date.now();
  const write = (event: object) => {
    const line = `${JSON.stringify(event)}\n`;
    lastWrite = Date.now();
    return new Promise<void>((resolve) => {
      process.stdout.write(line, (err) => {
        if (err && !abort.signal.aborted) {
          console.error(`${name}: connection closed (${err.message}); stopping`);
          abort.abort();
        }
        resolve();
      });
    });
  };
  process.stdout.on("error", () => { abort.abort(); });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastWrite >= HEARTBEAT_MS) void write({ event: "heartbeat" });
  }, HEARTBEAT_MS / 2);

  const io: JobIo = {
    progress: (p) => void write({ event: "progress", ...p }),
    log: (line) => void write({ event: "log", line: line.slice(0, 2000) }),
    signal: abort.signal,
  };
  try {
    const raw: unknown = JSON.parse(await readRequestLine());
    const request = schema.parse(raw);
    console.error(`${name}: job started`);
    const done = await job(request, io);
    await write(done);
    console.error(`${name}: job done`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${name}: job failed: ${message}`);
    await write({ event: "error", message: message.slice(0, 2000) });
    process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
  }
  // Closing stdout ends our side of the connection; then exit, even if a child is still exiting.
  process.stdout.end(() => process.exit());
}
