// The runners' output folder ($STATE_DIRECTORY/incoming): the app reads what a runner left there
// and deletes it afterwards (incoming/ and the job folders in it are group-writable for
// memex-data). Everything in it is untrusted, so every path is built from a validated job
// folder name and a relative file name, the file is opened without following links (O_NOFOLLOW),
// must be a regular file, and must resolve to exactly where its name says (no linked folders).

import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { JobDirSchema } from "../../shared/runners.ts";
import type { ByteStream, IncomingStore } from "../archive/ports.ts";

// A relative name inside a job folder: one or two plain segments ("poster.jpg", "hls/media.mp4").
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
function checkName(name: string): string {
  const segments = name.split("/");
  if (segments.length > 2 || !segments.every((s) => NAME.test(s) && s !== "." && s !== "..")) throw new Error(`invalid file name in a job folder: ${name}`);
  return name;
}

export function createIncomingStore(root: string): IncomingStore {
  const dirPath = (dir: string) => join(root, JobDirSchema.parse(dir));

  async function openChecked(dir: string, name: string) {
    const path = join(dirPath(dir), checkName(name));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a validated job folder + a validated relative name (above)
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new Error(`${name} is not a regular file`);
      // A linked folder on the way (hls -> elsewhere) would resolve somewhere else.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the same validated path as the open() above
      const expected = join(await realpath(root), JobDirSchema.parse(dir), name);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above
      if ((await realpath(path)) !== expected) throw new Error(`${name} is not inside its job folder`);
      return { handle, size: st.size };
    } catch (err) {
      await handle.close();
      throw err;
    }
  }

  return {
    async open(dir, name) {
      const { handle, size } = await openChecked(dir, name);
      const stream = handle.createReadStream(); // closes the handle when done
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node's stream/web ReadableStream is the global one; only the type declarations differ
      return { stream: Readable.toWeb(stream) as unknown as ByteStream, size };
    },

    async head(dir, name, maxBytes) {
      const { handle, size } = await openChecked(dir, name);
      try {
        const buf = new Uint8Array(Math.min(size, maxBytes));
        let read = 0;
        while (read < buf.length) {
          const { bytesRead } = await handle.read(buf, read, buf.length - read, read);
          if (bytesRead === 0) break;
          read += bytesRead;
        }
        return buf.subarray(0, read);
      } finally {
        await handle.close();
      }
    },

    async removeDir(dir) {
      await rm(dirPath(dir), { recursive: true, force: true });
    },

    async sweep(olderThanMs) {
      let removed = 0;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the incoming root server.ts passes in
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || !JobDirSchema.safeParse(entry.name).success) continue;
        const path = dirPath(entry.name);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- a job folder name read from incoming/ and validated
        const st = await lstat(path).catch(() => null);
        if (st && st.mtimeMs < olderThanMs) {
          await rm(path, { recursive: true, force: true });
          removed++;
        }
      }
      return removed;
    },
  };
}
