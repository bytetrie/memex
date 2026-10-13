// The incoming store reads only regular files inside a job folder, never through a link.

import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIncomingStore } from "./incoming.ts";

let root = "";
let outside = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "incoming-test-"));
  outside = await mkdtemp(join(tmpdir(), "outside-test-"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
  await mkdir(join(root, "job-abcdef", "hls"), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
  await writeFile(join(root, "job-abcdef", "poster.jpg"), "jpeg bytes");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
  await writeFile(join(root, "job-abcdef", "hls", "media.mp4"), "mp4 bytes");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
  await writeFile(join(outside, "secret"), "do not read");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("incoming store", () => {
  it("reads files and heads inside a job folder", async () => {
    const store = createIncomingStore(root);
    const { stream, size } = await store.open("job-abcdef", "hls/media.mp4");
    expect(size).toBe(9);
    expect(await new Response(stream).text()).toBe("mp4 bytes");
    expect(new TextDecoder().decode(await store.head("job-abcdef", "poster.jpg", 4))).toBe("jpeg");
  });

  it("refuses odd names, links and folders", async () => {
    const store = createIncomingStore(root);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await symlink(join(outside, "secret"), join(root, "job-abcdef", "link.jpg"));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await symlink(outside, join(root, "job-abcdef", "linkdir"));
    for (const [dir, name] of [
      ["job-abcdef", "../job-abcdef/poster.jpg"],
      ["job-abcdef", "/etc/passwd"],
      ["job-abcdef", "a/b/c"],
      ["job-abcdef", ".hidden"],
      ["../etc", "passwd"],
      ["job-abcdef", "link.jpg"],
      ["job-abcdef", "linkdir/secret"],
      ["job-abcdef", "hls"],
      ["job-abcdef", "missing.jpg"],
    ]) {
      await expect(store.head(dir ?? "", name ?? "", 10), `${dir ?? ""} ${name ?? ""}`).rejects.toThrow();
    }
  });

  it("removes job folders, and sweeps the stale ones only", async () => {
    const store = createIncomingStore(root);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(join(root, "job-fresh1"));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await mkdir(join(root, "not-a-job"));
    const old = new Date(Date.now() - 2 * 86_400_000);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    await utimes(join(root, "job-abcdef"), old, old);
    expect(await store.sweep(Date.now() - 86_400_000)).toBe(1);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect((await readdir(root)).sort()).toEqual(["job-fresh1", "not-a-job"]);
    await store.removeDir("job-fresh1");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the test's own temp dir
    expect(await readdir(root)).toEqual(["not-a-job"]);
  });
});
