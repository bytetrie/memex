// The pinned yt-dlp the `ytdlp` runner runs: the official release's bundled Linux build
// (yt-dlp_linux.zip: yt-dlp with its own Python and curl_cffi, which yt-dlp needs to impersonate a
// browser for some sites), pinned by version + sha256 in infra/yt-dlp.lock and unpacked into
// gitignored vendor/yt-dlp/<version>/, with vendor/yt-dlp/current pointing at the pinned one.
// yt-dlp has to follow site changes quickly, so it is not an apt package (Debian's is far behind)
// and updating it is one command.
//   pnpm yt-dlp install            unpack the pinned version if vendor/ doesn't have it (sync-env.sh runs this)
//   pnpm yt-dlp update [version]   pin the latest release (or `version`) and install it
// `update` trusts a release only when its SHA2-256SUMS carries a good signature from yt-dlp's
// signing key (infra/yt-dlp/public.key, fingerprint below); `install` checks the pinned sha256.
// The lock change is reviewed like a lockfile change. No restart needed: every job is a new process,
// and the previous version stays unpacked, so a job that is running while you update keeps working.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { arch, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { run } from "../src/server/node/child-process.ts";

const ROOT = join(import.meta.dirname, "..");
const LOCK = join(ROOT, "infra/yt-dlp.lock");
const KEY = join(ROOT, "infra/yt-dlp/public.key");
const VENDOR = join(ROOT, "vendor/yt-dlp");
const CURRENT = join(VENDOR, "current");
// What the runner runs (scripts/runners/ytdlp.ts).
export const YT_DLP_PATH = join(CURRENT, "yt-dlp_linux");
// The x86_64 build; other machines would need yt-dlp_linux_aarch64.zip.
const ASSET = "yt-dlp_linux.zip";
// yt-dlp's release signing key, as published in its README (public.key in the yt-dlp repo).
const FINGERPRINT = "AC0CBBE6848D6A873464AF4E57CF65933B5A7581";
const RELEASES = "https://github.com/yt-dlp/yt-dlp/releases";
const MARKER = ".sha256"; // in an unpacked version: the sha256 of the zip it came from

const VersionSchema = z.string().refine((v) => /^\d{4}\.\d{2}\.\d{2}$/.test(v) || /^\d{4}\.\d{2}\.\d{2}\.\d{1,6}$/.test(v), "expected a release tag such as 2026.08.19");
const LockSchema = z.object({ version: VersionSchema, asset: z.literal(ASSET), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
type Lock = z.infer<typeof LockSchema>;

class UsageError extends Error {}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
  return new Uint8Array(await res.arrayBuffer());
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readLock(): Promise<Lock> {
  return LockSchema.parse(JSON.parse(await readFile(LOCK, "utf8")));
}

// Whether vendor/ holds the pinned version, unpacked from the pinned zip, and `current` points at it.
async function installed(lock: Lock): Promise<boolean> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- vendor/yt-dlp/<validated version>
    const marker = (await readFile(join(VENDOR, lock.version, MARKER), "utf8")).trim();
    return marker === lock.sha256 && (await readlink(CURRENT)) === lock.version;
  } catch {
    return false;
  }
}

// Zip entries must be plain relative paths inside the folder they are unpacked into.
function checkEntries(listing: string): void {
  for (const name of listing.split("\n").filter((l) => l !== "")) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`${ASSET} holds an unsafe path: ${name}`);
  }
}

async function install(lock: Lock): Promise<void> {
  if (arch() !== "x64") throw new Error(`${ASSET} is the x86_64 build; this machine is ${arch()}`);
  if (await installed(lock)) {
    console.log(`yt-dlp ${lock.version} is installed (${YT_DLP_PATH})`);
    return;
  }
  const bytes = await download(`${RELEASES}/download/${lock.version}/${ASSET}`);
  const got = sha256(bytes);
  if (got !== lock.sha256) throw new Error(`${ASSET} ${lock.version}: sha256 ${got} does not match infra/yt-dlp.lock (${lock.sha256})`);

  await mkdir(VENDOR, { recursive: true });
  const staging = join(VENDOR, `.staging-${randomUUID()}`);
  try {
    const zip = `${staging}.zip`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- vendor/yt-dlp/.staging-<uuid>.zip
    await writeFile(zip, bytes);
    const listing = await run("unzip", ["-Z1", zip]);
    if (listing.code !== 0) throw new Error(`unzip -Z1 failed: ${listing.stderr}`);
    checkEntries(listing.stdout);
    // unzip keeps the archive's file modes (the binary stays executable).
    const unpacked = await run("unzip", ["-q", zip, "-d", staging]);
    await rm(zip, { force: true });
    if (unpacked.code !== 0) throw new Error(`unzip failed: ${unpacked.stderr}`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside the staging folder
    await writeFile(join(staging, MARKER), `${lock.sha256}\n`);
    const version = await run(join(staging, "yt-dlp_linux"), ["--version"]);
    if (version.stdout.trim() !== lock.version) throw new Error(`the unpacked yt-dlp reports version "${version.stdout.trim()}" ${version.stderr}`);

    const target = join(VENDOR, lock.version);
    await rm(target, { recursive: true, force: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths inside vendor/yt-dlp built from a validated version and a uuid
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  // Point `current` at it in one step (a new link renamed over the old one).
  const previous = await readlink(CURRENT).catch(() => null);
  const link = join(VENDOR, `.current-${randomUUID()}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths inside vendor/yt-dlp built from a validated version and a uuid
  await symlink(lock.version, link);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths inside vendor/yt-dlp built from a validated version and a uuid
  await rename(link, CURRENT);

  // Keep the new and the previous version (a job may still be running the old one); remove the rest,
  // including the zipapp file earlier versions of this script installed.
  const keep = new Set(["current", lock.version, ...(previous ? [previous] : [])]);
  for (const name of await readdir(VENDOR)) if (!keep.has(name)) await rm(join(VENDOR, name), { recursive: true, force: true });
  console.log(`yt-dlp ${lock.version} installed (${YT_DLP_PATH})`);
}

// The sha256 of the bundled build, from the release's signed SHA2-256SUMS.
async function signedHash(version: string): Promise<string> {
  const sums = await download(`${RELEASES}/download/${version}/SHA2-256SUMS`);
  const sig = await download(`${RELEASES}/download/${version}/SHA2-256SUMS.sig`);
  const home = await mkdtemp(join(tmpdir(), "yt-dlp-gpg-"));
  try {
    const sumsPath = join(home, "SHA2-256SUMS");
    const sigPath = join(home, "SHA2-256SUMS.sig");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside a fresh temp dir
    await writeFile(sumsPath, sums);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside a fresh temp dir
    await writeFile(sigPath, sig);
    // A throwaway keyring holding only yt-dlp's key; the user's own keyring is never touched.
    const imported = await run("gpg", ["--homedir", home, "--batch", "--quiet", "--import", KEY]);
    if (imported.code !== 0) throw new Error(`gpg --import failed: ${imported.stderr}`);
    const verified = await run("gpg", ["--homedir", home, "--batch", "--status-fd", "1", "--verify", sigPath, sumsPath]);
    const valid = verified.stdout.split("\n").some((line) => line.startsWith(`[GNUPG:] VALIDSIG ${FINGERPRINT} `));
    if (verified.code !== 0 || !valid) throw new Error(`SHA2-256SUMS of ${version} has no good signature from ${FINGERPRINT}:\n${verified.stderr}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  const line = new TextDecoder().decode(sums).split("\n").find((l) => l.trim().endsWith(`  ${ASSET}`) && /^[0-9a-f]{64} /.test(l));
  if (!line) throw new Error(`SHA2-256SUMS of ${version} lists no ${ASSET}`);
  return line.slice(0, 64);
}

async function latestVersion(): Promise<string> {
  // /releases/latest redirects to /releases/tag/<version>.
  const res = await fetch(`${RELEASES}/latest`, { method: "HEAD", redirect: "follow" });
  return VersionSchema.parse(res.url.split("/").pop());
}

async function update(requested: string | undefined): Promise<void> {
  const version = requested === undefined ? await latestVersion() : VersionSchema.parse(requested);
  const lock: Lock = { version, asset: ASSET, sha256: await signedHash(version) };
  await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`infra/yt-dlp.lock: ${version} (${lock.sha256})`);
  await install(lock);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "install") await install(await readLock());
  else if (command === "update") await update(arg);
  else throw new UsageError("usage: pnpm yt-dlp install | update [version]");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
