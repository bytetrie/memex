// The runner client against a real loopback server standing in for a runner.

import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRunnerClient } from "./runner-client.ts";

let server: Server | undefined;
afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (server) server.close(() => { resolve(); });
      else resolve();
    }),
);

// A fake runner on a random port; `job` gets the request line and the connection.
async function fakeRunner(job: (request: string, socket: Socket) => void): Promise<number> {
  server = createServer((socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl >= 0) job(buf.slice(0, nl), socket);
    });
    socket.on("error", () => undefined);
  });
  const s = server;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const address = s.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

const clientFor = (port: number) => createRunnerClient("127.0.0.1", { ytdlp: port, encode: port });

describe("runner client", () => {
  it("sends the request and passes each reply line on until the runner closes", async () => {
    const port = await fakeRunner((request, socket) => {
      socket.write(`{"event":"log","line":${JSON.stringify(request)}}\n{"event":"pro`);
      socket.end(`gress","percent":5}\n{"event":"done"}\n`);
    });
    const events: unknown[] = [];
    await clientFor(port).run("ytdlp", { v: 1, op: "fetch" }, { signal: new AbortController().signal, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ event: "log", line: '{"v":1,"op":"fetch"}' }, { event: "progress", percent: 5 }, { event: "done" }]);
  });

  it("hangs up when cancelled, which the runner sees", async () => {
    let closed: () => void = () => undefined;
    const runnerSawClose = new Promise<void>((resolve) => { closed = resolve; });
    const port = await fakeRunner((_request, socket) => {
      socket.write('{"event":"heartbeat"}\n');
      socket.on("close", closed);
    });
    const abort = new AbortController();
    const run = clientFor(port).run("encode", {}, { signal: abort.signal, onEvent: () => { abort.abort(); } });
    await expect(run).rejects.toThrow("cancelled");
    await runnerSawClose;
  });

  it("fails on lines that are not JSON, and when the runner isn't there", async () => {
    const port = await fakeRunner((_request, socket) => { socket.end("not json\n"); });
    await expect(clientFor(port).run("ytdlp", {}, { signal: new AbortController().signal, onEvent: () => undefined })).rejects.toThrow(/not JSON/);
    await new Promise<void>((resolve) => server?.close(() => { resolve(); }));
    server = undefined;
    await expect(clientFor(port).run("ytdlp", {}, { signal: new AbortController().signal, onEvent: () => undefined })).rejects.toThrow(/not available/);
  });
});
