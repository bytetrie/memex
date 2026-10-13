// Talks to the runners over loopback TCP (src/shared/runners.ts): one connection per job. Sends the
// request line and keeps its side open, because closing it is how a job is cancelled. Reads JSON lines
// until the runner closes the connection. A runner writes at least a heartbeat every few seconds, so
// a minute of silence means it is stuck.

import { connect } from "node:net";
import { MAX_LINE_BYTES, RUNNER_PORTS } from "../../shared/runners.ts";
import type { RunnerClient } from "../archive/ports.ts";

const IDLE_MS = 60_000;

export function createRunnerClient(host = "127.0.0.1", ports: Record<keyof typeof RUNNER_PORTS, number> = RUNNER_PORTS): RunnerClient {
  return {
    run(name, request, { signal, onEvent }) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("cancelled"));
          return;
        }
        // eslint-disable-next-line security/detect-object-injection -- name is a RunnerName, typed
        const socket = connect({ host, port: ports[name] });
        let buffer = "";
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          socket.destroy();
          if (err) reject(err);
          else resolve();
        };
        const onAbort = () => { finish(new Error("cancelled")); };
        signal.addEventListener("abort", onAbort);

        socket.setEncoding("utf8");
        socket.setTimeout(IDLE_MS, () => { finish(new Error(`runner ${name} stopped responding`)); });
        socket.on("connect", () => {
          socket.write(`${JSON.stringify(request)}\n`);
        });
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.trim() === "") continue;
            let value: unknown;
            try {
              value = JSON.parse(line);
            } catch {
              finish(new Error(`runner ${name} sent a line that is not JSON`));
              return;
            }
            try {
              onEvent(value);
            } catch (err) {
              finish(err instanceof Error ? err : new Error(String(err)));
              return;
            }
          }
          if (buffer.length > MAX_LINE_BYTES) finish(new Error(`runner ${name} sent a line longer than ${String(MAX_LINE_BYTES)} bytes`));
        });
        socket.on("error", (err: NodeJS.ErrnoException) => {
          finish(
            err.code === "ECONNREFUSED"
              // eslint-disable-next-line security/detect-object-injection -- name is a RunnerName (typed), not user input
              ? new Error(`runner ${name} is not available on port ${String(ports[name])} (is it declared on the host?)`)
              : err,
          );
        });
        socket.on("close", () => { finish(); });
      });
    },
  };
}
