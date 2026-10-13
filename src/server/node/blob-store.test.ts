import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limitBytes } from "../archive/http.ts";
import { ArchiveError } from "../archive/ports.ts";
import { createBlobStore } from "./blob-store.ts";

const bytes = (s: string) => new Blob([s]).stream();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const read = async (stream: ReadableStream<Uint8Array> | null) => (stream ? await new Response(stream).text() : null);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "blob-store-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("blob store", () => {
  it("stores bytes under their sha256 and reads them back", async () => {
    const store = createBlobStore(dir);
    expect(await store.put(bytes("hello"))).toEqual({ sha256: sha("hello"), size: 5 });
    expect(await read(await store.get(sha("hello")))).toBe("hello");
    await stat(join(dir, "blobs", sha("hello").slice(0, 2), sha("hello").slice(2, 4), sha("hello")));
  });

  it("stores identical content once and leaves no temp files", async () => {
    const store = createBlobStore(dir);
    await store.put(bytes("same"));
    await store.put(bytes("same"));
    const found = [];
    for await (const f of store.list()) found.push(f.sha256);
    expect(found).toEqual([sha("same")]);
    expect(await readdir(join(dir, "tmp"))).toEqual([]);
  });

  it("aborts an upload that goes past a byte limit, keeping the error and no temp file", async () => {
    const store = createBlobStore(dir);
    await expect(store.put(limitBytes(bytes("too long"), 3))).rejects.toSatisfy((err) => err instanceof ArchiveError && err.code === "too_large");
    expect(await readdir(join(dir, "tmp"))).toEqual([]);
    for await (const f of store.list()) throw new Error(`unexpected blob ${f.sha256}`);
  });

  it("handles empty content", async () => {
    const store = createBlobStore(dir);
    expect((await store.put(bytes(""))).size).toBe(0);
  });

  it("serves inclusive byte ranges", async () => {
    const store = createBlobStore(dir);
    await store.put(bytes("0123456789"));
    expect(await read(await store.get(sha("0123456789"), { start: 2, end: 4 }))).toBe("234");
  });

  it("returns null for a missing blob and refuses malformed hashes", async () => {
    const store = createBlobStore(dir);
    expect(await store.get("0".repeat(64))).toBeNull();
    await expect(store.get("../../etc/passwd")).rejects.toThrow("invalid sha256");
    await expect(store.delete("nope")).rejects.toThrow("invalid sha256");
  });

  it("deletes blobs, and deleting twice is fine", async () => {
    const store = createBlobStore(dir);
    await store.put(bytes("gone"));
    await store.delete(sha("gone"));
    await store.delete(sha("gone"));
    expect(await store.get(sha("gone"))).toBeNull();
  });

  it("cleans up the temp file when the upload fails", async () => {
    const store = createBlobStore(dir);
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("client went away"));
      },
    });
    await expect(store.put(failing)).rejects.toThrow("client went away");
    expect(await readdir(join(dir, "tmp"))).toEqual([]);
  });

  it("sweeps only old temp files", async () => {
    const store = createBlobStore(dir);
    const old = join(dir, "tmp", "old");
    await writeFile(old, "x");
    await utimes(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    await writeFile(join(dir, "tmp", "fresh"), "x");
    expect(await store.sweepTmp(Date.now() - 60_000)).toBe(1);
    expect(await readdir(join(dir, "tmp"))).toEqual(["fresh"]);
  });
});
