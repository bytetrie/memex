// The one place that starts processes (eslint allows child_process only here). Always an
// executable plus an argument array, never a shell, so no argument is ever parsed as shell syntax.
// Used by scripts (scripts/yt-dlp.ts) and the runners (scripts/runners/); the app itself starts
// no processes.

import { spawn, type ChildProcess } from "node:child_process";

export type RunOptions = {
  cwd?: string;
  // Replaces the environment when given (runners pass a minimal one).
  env?: Record<string, string>;
  // Written to stdin, which is then closed.
  input?: string | Uint8Array;
  signal?: AbortSignal;
  // Output kept per stream; anything beyond it is dropped (the head is kept).
  maxOutputBytes?: number;
};

export type RunResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

// Runs to completion and collects the output. Resolves whatever the exit status; rejects only when
// the process can't be started (e.g. the executable is missing).
export function run(command: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const max = opts.maxOutputBytes ?? 16 * 1024 ** 2;
  return new Promise((resolve, reject) => {
    const child = start(command, args, { cwd: opts.cwd, env: opts.env, signal: opts.signal, stdin: opts.input === undefined ? "ignore" : "pipe" });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const collect = (into: Buffer[]) => {
      let kept = 0;
      return (chunk: Buffer) => {
        if (kept >= max) return;
        const part = chunk.subarray(0, max - kept);
        kept += part.byteLength;
        into.push(part);
      };
    };
    child.stdout?.on("data", collect(out));
    child.stderr?.on("data", collect(err));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

export type StartOptions = {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  stdin?: "pipe" | "ignore";
};

// Starts a process with piped stdout/stderr, for callers that read its output as it comes.
// An aborted `signal` kills it with SIGTERM.
export function start(command: string, args: readonly string[], opts: StartOptions = {}): ChildProcess {
  return spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    signal: opts.signal,
    stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
}
