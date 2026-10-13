// Content-addressed file store on disk: <root>/blobs/ab/cd/<sha256>, with
// uploads in progress under <root>/tmp. A file is written to tmp while it is
// hashed, then renamed into place, so a blob is either complete or absent.
// `put` always copies the bytes it is given and never renames a foreign file
// into place, so blobs are owned by the app with its modes (UMask 0027).

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { opendir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Sha256Schema } from "../../shared/archive-types.ts";
import type { BlobStore, ByteStream } from "../archive/ports.ts";

export function createBlobStore(root: string): BlobStore {
  const blobsDir = join(root, "blobs");
  const tmpDir = join(root, "tmp");
  mkdirSync(blobsDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  // The only place a hash becomes a path; refuses anything but 64 hex digits.
  const pathOf = (sha256: string) => {
    if (!Sha256Schema.safeParse(sha256).success) throw new Error(`invalid sha256: ${sha256}`);
    return join(blobsDir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  };

  return {
    async put(stream: ByteStream) {
      const tmp = join(tmpDir, randomUUID());
      const hash = createHash("sha256");
      let size = 0;
      try {
        await pipeline(
          stream,
          async function* (source: AsyncIterable<Uint8Array>) {
            for await (const chunk of source) {
              hash.update(chunk);
              size += chunk.byteLength;
              yield chunk;
            }
          },
          createWriteStream(tmp, { flags: "wx" }),
        );
        const sha256 = hash.digest("hex");
        const dest = pathOf(sha256);
        const exists = await stat(dest).then(() => true, () => false);
        if (exists) {
          await unlink(tmp);
        } else {
          mkdirSync(dirname(dest), { recursive: true });
          await rename(tmp, dest);
        }
        return { sha256, size };
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },

    async get(sha256, range) {
      const path = pathOf(sha256);
      if (!(await stat(path).then(() => true, () => false))) return null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node's stream/web ReadableStream is the global one; only the type declarations differ
      return Readable.toWeb(createReadStream(path, range)) as unknown as ByteStream;
    },

    async delete(sha256) {
      await rm(pathOf(sha256), { force: true });
    },

    async *list() {
      for (const a of await readdir(blobsDir)) {
        for (const b of await readdir(join(blobsDir, a)).catch(() => [])) {
          const dir = await opendir(join(blobsDir, a, b));
          for await (const entry of dir) {
            if (!entry.isFile() || !Sha256Schema.safeParse(entry.name).success) continue;
            yield { sha256: entry.name, mtimeMs: (await stat(join(entry.parentPath, entry.name))).mtimeMs };
          }
        }
      }
    },

    async sweepTmp(olderThanMs) {
      let removed = 0;
      for (const name of await readdir(tmpDir)) {
        const path = join(tmpDir, name);
        if ((await stat(path)).mtimeMs < olderThanMs) {
          await rm(path, { force: true });
          removed++;
        }
      }
      return removed;
    },
  };
}
