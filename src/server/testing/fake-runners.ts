// A RunnerClient for tests: each runner is a function the test registers, which gets the request
// and emits events as a real runner would (they go through JSON, like over the wire). It writes
// files into the harness's incoming folder itself.

import type { RunnerName } from "../../shared/runners.ts";
import type { RunnerClient } from "../archive/ports.ts";

export type FakeRunner = (request: unknown, emit: (event: object) => void, signal: AbortSignal) => Promise<void>;

export function fakeRunners() {
  const handlers = new Map<RunnerName, FakeRunner>();
  const calls: { name: RunnerName; request: unknown }[] = [];
  const client: RunnerClient = {
    async run(name, request, { signal, onEvent }) {
      calls.push({ name, request });
      const handler = handlers.get(name);
      if (!handler) throw new Error(`runner ${name} is not available`);
      const parsed: unknown = JSON.parse(JSON.stringify(request));
      await handler(parsed, (event) => { onEvent(JSON.parse(JSON.stringify(event))); }, signal);
      if (signal.aborted) throw new Error("cancelled");
    },
  };
  return {
    client,
    calls,
    handle(name: RunnerName, fn: FakeRunner) {
      handlers.set(name, fn);
    },
    reset() {
      handlers.clear();
      calls.length = 0;
    },
  };
}
