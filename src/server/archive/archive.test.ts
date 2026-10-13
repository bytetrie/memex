// Integration tests: the real app + drizzle repo on memex_test, blob store in a temp dir.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArchiveTypeInfoSchema, EntryListSchema, EntrySchema, ErrorSchema, GcResultSchema, RecentSearchesSchema, type Entry } from "../../shared/archive.ts";
import { MAX_FILE_BYTES } from "../../shared/archive-types.ts";
import { useHarness } from "../testing/harness.ts";
import { silentLogger } from "../testing/harness.ts";
import { sweep } from "./gc.ts";

const h = useHarness();
const A = "/api/archive";

// Responses are parsed with the API's schemas, as the web client does.
const asEntry = async (res: Response) => EntrySchema.parse(await res.json());
const asList = async (res: Response) => EntryListSchema.parse(await res.json());
const asGc = async (res: Response) => GcResultSchema.parse(await res.json());
const asSearches = async (res: Response) => RecentSearchesSchema.parse(await res.json());
// A 400: the message and what was wrong, by path.
const InvalidSchema = ErrorSchema.extend({ issues: z.array(z.object({ path: z.unknown() })) });

async function createText(text: string, extra: Record<string, unknown> = {}): Promise<Entry> {
  const res = await h.send(`${A}/entries`, { type: "text", input: { text }, ...extra });
  expect(res.status).toBe(201);
  return asEntry(res);
}

// The hash of an entry's first file.
function firstSha(entry: Entry): string {
  const file = entry.files[0];
  if (!file) throw new Error(`entry ${entry.id} has no files`);
  return file.sha256;
}

describe("types", () => {
  it("lists the registered types with their input JSON Schema", async () => {
    const types = z.array(ArchiveTypeInfoSchema).parse(await (await h.request(`${A}/types`)).json());
    expect(types.map((t) => [t.id, t.mode])).toEqual([["file", "entry"], ["text", "entry"], ["video", "job"]]);
    expect(types.find((t) => t.id === "text")?.inputSchema.properties).toHaveProperty("text");
  });
});

describe("creating entries", () => {
  it("text: stores content.md and derives the title", async () => {
    const entry = await createText("# My notes\nhello", { tags: ["Idea", "idea", "b"] });
    expect(entry).toMatchObject({ type: "text", title: "My notes", tags: ["b", "idea"], fileCount: 1, thumbnails: [], refs: [] });
    expect(entry.files[0]).toMatchObject({ name: "content.md", role: "original", mime: "text/markdown", size: 16 });
  });

  it("file: upload a text file, then create the entry naming it", async () => {
    const blob = await h.upload("# Manual\nhow to use the thing");
    const res = await h.send(`${A}/entries`, { type: "file", title: "Manual", input: { files: [{ sha256: blob.sha256, name: "docs/manual.md" }] } });
    expect(res.status).toBe(201);
    const entry = await asEntry(res);
    expect(entry.title).toBe("Manual");
    expect(entry.files[0]).toMatchObject({ name: "docs/manual.md", mime: "text/markdown", sha256: blob.sha256, size: blob.size });
  });

  it("file: picks the stored mime type itself, ignoring a declared non-text one", async () => {
    const blob = await h.upload("a,b\n1,2\n");
    const entry = await asEntry(
      await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name: "data.csv", mime: "application/vnd.ms-excel" }] } }),
    );
    expect(entry.files[0]?.mime).toBe("text/csv");
  });

  it("file: only accepts text files", async () => {
    const png = await h.upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    const nuls = await h.upload(new Uint8Array([0x4d, 0x5a, 0x00, 0x03, 0x00, 0x00])); // valid UTF-8 bytes, but binary
    const latin1 = await h.upload(new Uint8Array([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1: not UTF-8
    const empty = await h.upload("  \n");
    for (const [name, blob, reason] of [
      ["photo.png", png, "is not valid UTF-8 text"],
      ["program.bin", nuls, "contains binary data"],
      ["old.txt", latin1, "is not valid UTF-8 text"],
      ["blank.txt", empty, "has no text in it"],
    ] as const) {
      const res = await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name }] } });
      expect(res.status, name).toBe(400);
      const body = InvalidSchema.parse(await res.json());
      expect(body.error).toBe(`${name} ${reason}; only text files can be added`);
      expect(body.issues[0]?.path).toBe("files.0");
    }
    expect((await asList(await h.request(`${A}/entries`))).items).toEqual([]);
  });

  it("file: refused uploads are removed from the store and the database right away", async () => {
    const bad = await h.upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));
    expect(await h.archive.blobs.get(bad.sha256)).not.toBeNull();
    const res = await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: bad.sha256, name: "photo.png" }] } });
    expect(res.status).toBe(400);
    expect(await h.archive.blobs.get(bad.sha256)).toBeNull();
    expect((await h.archive.repo.existingBlobs([bad.sha256])).size).toBe(0);
  });

  it("file: a refused file is discarded even when a later file is an unknown blob", async () => {
    const bad = await h.upload(new Uint8Array([0, 1, 2, 3]));
    const res = await h.send(`${A}/entries`, {
      type: "file",
      input: { files: [{ sha256: bad.sha256, name: "a.bin" }, { sha256: "d".repeat(64), name: "b.txt" }] },
    });
    expect(res.status).toBe(422);
    // The request fails on the unknown blob, and the bad file inspected before it is still discarded.
    expect(await h.archive.blobs.get(bad.sha256)).toBeNull();
  });

  it("file: one bad file refuses the whole entry and names it", async () => {
    const good = await h.upload("fine text");
    const bad = await h.upload(new Uint8Array([0, 1, 2, 3, 4]));
    const res = await h.send(`${A}/entries`, {
      type: "file",
      input: { files: [{ sha256: good.sha256, name: "ok.txt" }, { sha256: bad.sha256, name: "clip.mp4" }] },
    });
    expect(res.status).toBe(400);
    expect(ErrorSchema.parse(await res.json()).error).toContain("clip.mp4");
    expect(await h.archive.blobs.get(bad.sha256)).toBeNull(); // refused: gone
    expect(await h.archive.blobs.get(good.sha256)).not.toBeNull(); // fine: kept for a retry
    expect((await asList(await h.request(`${A}/entries`))).items).toEqual([]);
  });

  it("file: uploading identical bytes twice gives the same blob", async () => {
    expect(await h.upload("dup")).toEqual(await h.upload("dup"));
  });

  it("refuses uploads over MAX_FILE_BYTES (413) before reading them", async () => {
    const res = await h.request(`${A}/blobs`, { method: "PUT", headers: { "content-length": String(MAX_FILE_BYTES + 1) }, body: "x" });
    expect(res.status).toBe(413);
  });

  it("refuses JSON bodies over the JSON limit (413)", async () => {
    const res = await h.send(`${A}/entries`, { type: "text", input: { text: "x".repeat(9 * 1024 ** 2) } });
    expect(res.status).toBe(413);
    // Every content type Hono's json validator parses is limited too.
    const body = JSON.stringify({ type: "text", input: { text: "x".repeat(9 * 1024 ** 2) } });
    for (const type of ["application/merge-patch+json", "Application/JSON; charset=utf-8"]) {
      expect((await h.request(`${A}/entries`, { method: "POST", headers: { "content-type": type }, body })).status, type).toBe(413);
    }
  });

  it("rejects a body that is not JSON with 400, not 500", async () => {
    const res = await h.request(`${A}/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("file: rejects a blob that was never uploaded (422) and bad input (400)", async () => {
    const missing = await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: "b".repeat(64), name: "x" }] } });
    expect(missing.status).toBe(422);
    const bad = await h.send(`${A}/entries`, { type: "file", input: { files: [] } });
    expect(bad.status).toBe(400);
    expect(InvalidSchema.parse(await bad.json()).issues.length).toBeGreaterThan(0);
    expect((await h.send(`${A}/entries`, { type: "nope", input: {} })).status).toBe(400);
    expect((await h.send(`${A}/entries`, { type: "text", input: { text: "  " } })).status).toBe(400);
  });
});

describe("finding entries", () => {
  it("lists recent additions newest first and pages with a cursor", async () => {
    const titles = ["one", "two", "three"];
    for (const t of titles) await createText(t);
    const first = await asList(await h.request(`${A}/entries?limit=2`));
    expect(first.items.map((e) => e.title)).toEqual(["three", "two"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await asList(await h.request(`${A}/entries?limit=2&cursor=${first.nextCursor ?? ""}`));
    expect(second.items.map((e) => e.title)).toEqual(["one"]);
    expect(second.nextCursor).toBeNull();
  });

  it("finds file entries by words inside their text files", async () => {
    const blob = await h.upload("meeting minutes: the zeppelin budget was approved");
    const second = await h.upload("appendix about walruses");
    await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name: "minutes.txt" }, { sha256: second.sha256, name: "extra.md" }] } });
    const search = async (q: string) => (await asList(await h.request(`${A}/entries?q=${encodeURIComponent(q)}`))).items.map((e) => e.title);
    expect(await search("zeppelin budget")).toEqual(["minutes.txt"]);
    expect(await search("walruses")).toEqual(["minutes.txt"]);
    expect(await search("giraffe")).toEqual([]);
  });

  it("searches titles by word prefix, also inside file names", async () => {
    const blob = await h.upload("x");
    await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name: "quarterly-report.pdf" }] } });
    await createText("Holiday plans");
    const search = async (q: string) => (await asList(await h.request(`${A}/entries?q=${encodeURIComponent(q)}`))).items.map((e) => e.title);
    expect(await search("quart")).toEqual(["quarterly-report.pdf"]);
    expect(await search("report pdf")).toEqual(["quarterly-report.pdf"]);
    expect(await search("hol plan")).toEqual(["Holiday plans"]);
    expect(await search("nothing")).toEqual([]);
    expect(await search("!!!")).toEqual([]);
  });

  it("finds text entries by words in their content, without exposing the indexed text", async () => {
    const entry = await createText("# Shopping\n\nbuy oranges and a quokka-shaped lamp");
    const search = async (q: string) => (await asList(await h.request(`${A}/entries?q=${encodeURIComponent(q)}`))).items.map((e) => e.title);
    expect(await search("oranges")).toEqual(["Shopping"]);
    expect(await search("quokka lamp")).toEqual(["Shopping"]);
    expect(await search("shop")).toEqual(["Shopping"]);
    expect(await search("pineapple")).toEqual([]);
    expect(JSON.stringify(await (await h.request(`${A}/entries/${entry.id}`)).json())).not.toContain("quokka");
  });

  it("filters by type and tag", async () => {
    await createText("tagged", { tags: ["work"] });
    await createText("plain");
    const blob = await h.upload("f");
    await h.send(`${A}/entries`, { type: "file", tags: ["work"], input: { files: [{ sha256: blob.sha256, name: "f.txt" }] } });
    const titles = async (qs: string) => (await asList(await h.request(`${A}/entries?${qs}`))).items.map((e) => e.title).sort();
    expect(await titles("tag=work")).toEqual(["f.txt", "tagged"]);
    expect(await titles("type=text")).toEqual(["plain", "tagged"]);
    expect(await titles("type=text&tag=work")).toEqual(["tagged"]);
  });

  describe("#tags in the search box", () => {
    const find = async (q: string, extra = "") =>
      (await asList(await h.request(`${A}/entries?q=${encodeURIComponent(q)}${extra}`))).items.map((e) => e.title).sort();

    it("matches entries that have every tag (AND)", async () => {
      await createText("both tags", { tags: ["alpha", "beta"] });
      await createText("only alpha", { tags: ["alpha"] });
      await createText("only beta", { tags: ["beta"] });
      await createText("no tags");
      expect(await find("#alpha")).toEqual(["both tags", "only alpha"]);
      expect(await find("#alpha #beta")).toEqual(["both tags"]);
      expect(await find("#beta #alpha")).toEqual(["both tags"]);
      expect(await find("#alpha #beta #gamma")).toEqual([]);
    });

    it("combines tags with words and with the type filter", async () => {
      await createText("quarterly plan", { tags: ["work", "2026"] });
      await createText("quarterly party", { tags: ["fun", "2026"] });
      const blob = await h.upload("quarterly numbers");
      await h.send(`${A}/entries`, { type: "file", tags: ["work", "2026"], input: { files: [{ sha256: blob.sha256, name: "numbers.txt" }] } });
      expect(await find("quarterly #2026")).toEqual(["numbers.txt", "quarterly party", "quarterly plan"]);
      expect(await find("quarterly #work #2026")).toEqual(["numbers.txt", "quarterly plan"]);
      expect(await find("quarterly #work #2026", "&type=text")).toEqual(["quarterly plan"]);
      expect(await find("party #work")).toEqual([]);
    });

    it("ignores case and supports quoted tags with spaces", async () => {
      await createText("spaced", { tags: ["my tag", "x"] });
      expect(await find('#"My Tag"')).toEqual(["spaced"]);
      expect(await find('#"my tag" #X')).toEqual(["spaced"]);
    });

    it("adds up with the tag parameter, and a lone # finds nothing", async () => {
      await createText("a", { tags: ["one", "two"] });
      await createText("b", { tags: ["one"] });
      expect(await find("#one", "&tag=two")).toEqual(["a"]);
      expect(await find("#")).toEqual([]);
    });
  });

  it("validates the query", async () => {
    expect((await h.request(`${A}/entries?limit=0`)).status).toBe(400);
    expect((await h.request(`${A}/entries?cursor=nope`)).status).toBe(400);
    expect((await h.request(`${A}/entries?type=nope`)).status).toBe(400);
  });

  it("records searches and lists the most recent distinct ones", async () => {
    for (const query of ["a", "b", "a"]) expect((await h.send(`${A}/searches`, { query })).status).toBe(204);
    await h.send(`${A}/searches`, { query: "a", type: "text" });
    const { items } = await asSearches(await h.request(`${A}/searches`));
    expect(items.map((s) => [s.query, s.type])).toEqual([["a", "text"], ["a", null], ["b", null]]);
  });

  it("removes a recent search by query and type, leaving the others", async () => {
    for (const body of [{ query: "a" }, { query: "a", type: "text" }, { query: "b" }, { query: "a" }]) await h.send(`${A}/searches`, body);
    const list = async () =>
      (await asSearches(await h.request(`${A}/searches`))).items
        .map((s) => `${s.query}|${s.type ?? "null"}`)
        .sort();

    // No type: only the "all types" search "a" goes (both times it was run); "a" in text stays.
    expect((await h.request(`${A}/searches?query=a`, { method: "DELETE" })).status).toBe(204);
    expect(await list()).toEqual(["a|text", "b|null"]);

    expect((await h.request(`${A}/searches?query=a&type=text`, { method: "DELETE" })).status).toBe(204);
    expect(await list()).toEqual(["b|null"]);

    expect((await h.request(`${A}/searches?query=nothing`, { method: "DELETE" })).status).toBe(204); // nothing to remove is fine
    expect((await h.request(`${A}/searches`, { method: "DELETE" })).status).toBe(400); // query is required
    expect(await list()).toEqual(["b|null"]);
  });
});

describe("one entry", () => {
  it("returns 404 for a missing entry and 400 for a malformed id", async () => {
    expect((await h.request(`${A}/entries/019a0000-0000-7000-8000-000000000000`)).status).toBe(404);
    expect((await h.request(`${A}/entries/not-a-uuid`)).status).toBe(400);
  });

  it("changes title and tags only", async () => {
    const entry = await createText("original", { tags: ["a"] });
    const res = await h.send(`${A}/entries/${entry.id}`, { title: "renamed", tags: ["B", "c"] }, "PATCH");
    expect(await res.json()).toMatchObject({ title: "renamed", tags: ["b", "c"] });
    expect((await h.send(`${A}/entries/${entry.id}`, {}, "PATCH")).status).toBe(400);
    expect((await h.send(`${A}/entries/019a0000-0000-7000-8000-000000000000`, { title: "x" }, "PATCH")).status).toBe(404);
  });
});

describe("serving files", () => {
  it("streams the file with its type, ETag and download policy", async () => {
    const entry = await createText("hello world");
    const res = await h.request(`${A}/entries/${entry.id}/files/content.md`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello world");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(res.headers.get("etag")).toBe(`"${firstSha(entry)}"`);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers Range requests, 304 for a matching ETag and 416 outside the file", async () => {
    const entry = await createText("0123456789");
    const url = `${A}/entries/${entry.id}/files/content.md`;
    const part = await h.request(url, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("234");
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    const etag = (await h.request(url)).headers.get("etag") ?? "";
    expect((await h.request(url, { headers: { "if-none-match": `W/${etag}` } })).status).toBe(304);
    const bad = await h.request(url, { headers: { range: "bytes=50-" } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");
  });

  it("sends anything a browser could render or run as plain text, whatever its name or declared type", async () => {
    for (const [content, name, mime, served] of [
      ["<script>alert(1)</script>", "page.html", "text/html", "text/plain; charset=utf-8"],
      ['<svg xmlns="http://www.w3.org/2000/svg"/>', "pic.svg", "image/svg+xml", "text/plain; charset=utf-8"],
      ["alert(1)", "app.js", "application/javascript", "text/plain; charset=utf-8"],
      ["<a/>", "feed.xml", undefined, "text/plain; charset=utf-8"],
      ['{"a": 1}', "data.json", undefined, "application/json; charset=utf-8"],
      ["WEBVTT\n", "subs.vtt", undefined, "text/vtt; charset=utf-8"],
    ] as const) {
      const blob = await h.upload(content);
      const entry = await asEntry(await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name, mime }] } }));
      const res = await h.request(`${A}/entries/${entry.id}/files/${name}`);
      expect(res.headers.get("content-type"), name).toBe(served);
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
    }
  });

  it("serves nested names and 404s on unknown ones", async () => {
    const blob = await h.upload("seg");
    const entry = await asEntry(await h.send(`${A}/entries`, { type: "file", input: { files: [{ sha256: blob.sha256, name: "hls/seg 1.ts" }] } }));
    expect(await (await h.request(`${A}/entries/${entry.id}/files/hls/seg%201.ts`)).text()).toBe("seg");
    expect((await h.request(`${A}/entries/${entry.id}/files/missing`)).status).toBe(404);
    expect((await h.request(`${A}/entries/${entry.id}/files/..%2Fsecret`)).status).toBe(400);
  });
});

describe("refs and deleting", () => {
  it("a ref blocks deleting until it is released", async () => {
    const entry = await createText("keep me");
    const ref = `${A}/entries/${entry.id}/refs/notes/note-1`;
    expect((await h.request(ref, { method: "PUT" })).status).toBe(200);
    expect((await h.request(ref, { method: "PUT" })).status).toBe(200); // idempotent

    const detail = await asEntry(await h.request(`${A}/entries/${entry.id}`));
    expect(detail.refs).toMatchObject([{ module: "notes", itemId: "note-1" }]);

    const blocked = await h.request(`${A}/entries/${entry.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ refs: [{ module: "notes", itemId: "note-1" }] });

    expect((await h.request(ref, { method: "DELETE" })).status).toBe(204);
    expect((await h.request(ref, { method: "DELETE" })).status).toBe(404);
    expect((await h.request(`${A}/entries/${entry.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await h.request(`${A}/entries/${entry.id}`)).status).toBe(404);
    expect((await h.request(`${A}/entries/${entry.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("Postgres itself refuses to delete a referenced entry (ON DELETE RESTRICT)", async () => {
    const entry = await createText("guarded");
    await h.request(`${A}/entries/${entry.id}/refs/chat/c1`, { method: "PUT" });
    await expect(h.archive.repo.deleteEntry(entry.id)).rejects.toMatchObject({ code: "referenced" });
  });

  it("refs need an existing entry and a known module", async () => {
    expect((await h.request(`${A}/entries/019a0000-0000-7000-8000-000000000000/refs/notes/n`, { method: "PUT" })).status).toBe(404);
    const entry = await createText("x");
    expect((await h.request(`${A}/entries/${entry.id}/refs/bogus/n`, { method: "PUT" })).status).toBe(400);
  });
});

describe("garbage collection", () => {
  const deps = () => ({ ...h.archive, log: silentLogger });

  it("removes abandoned uploads after the grace period, keeps referenced blobs", async () => {
    const kept = await createText("kept");
    const abandoned = await h.upload("abandoned");

    // Inside the grace period nothing goes.
    expect(await sweep(deps())).toEqual({ blobs: [], strays: [], tmp: 0, incoming: 0, jobs: 0 });

    const result = await sweep(deps(), -1000);
    expect(result.blobs).toEqual([abandoned.sha256]);
    expect(await h.archive.blobs.get(abandoned.sha256)).toBeNull();
    expect(await (await h.request(`${A}/entries/${kept.id}/files/content.md`)).text()).toBe("kept");
  });

  it("deleting an entry frees its blobs right away", async () => {
    const doomed = await createText("doomed");
    expect(await h.archive.blobs.get(firstSha(doomed))).not.toBeNull();
    expect((await h.request(`${A}/entries/${doomed.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await h.archive.blobs.get(firstSha(doomed))).toBeNull();
    expect((await h.archive.repo.existingBlobs([firstSha(doomed)])).size).toBe(0);
  });

  it("deleting keeps a blob that another entry still uses", async () => {
    const first = await createText("shared bytes");
    const second = await createText("shared bytes");
    expect(firstSha(second)).toBe(firstSha(first));
    await h.request(`${A}/entries/${first.id}`, { method: "DELETE" });
    expect(await (await h.request(`${A}/entries/${second.id}/files/content.md`)).text()).toBe("shared bytes");
    await h.request(`${A}/entries/${second.id}`, { method: "DELETE" });
    expect(await h.archive.blobs.get(firstSha(first))).toBeNull();
  });

  it("deleting keeps a blob that was uploaded again meanwhile (a new entry may be about to use it)", async () => {
    const entry = await createText("again");
    await h.upload("again"); // same bytes, uploaded after the entry attached them
    await h.request(`${A}/entries/${entry.id}`, { method: "DELETE" });
    expect(await h.archive.blobs.get(firstSha(entry))).not.toBeNull();
    // It is now an unattached upload, so the gc collects it after the grace period.
    expect((await sweep(deps())).blobs).toEqual([]);
    expect((await sweep(deps(), -1000)).blobs).toEqual([firstSha(entry)]);
  });

  it("removes store files that never got a row", async () => {
    const stray = await h.archive.blobs.put(new Blob(["stray"]).stream());
    const result = await sweep(deps(), -1000);
    expect(result.strays).toEqual([stray.sha256]);
  });

  it("is available as POST /archive/gc, with graceHours", async () => {
    const res = await h.request(`${A}/gc`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await asGc(res)).toEqual({ blobs: [], strays: [], tmp: 0, incoming: 0, jobs: 0 });

    const upload = await h.upload("fresh upload");
    expect((await asGc(await h.request(`${A}/gc`, { method: "POST" }))).blobs).toEqual([]);
    expect((await asGc(await h.request(`${A}/gc?graceHours=0`, { method: "POST" }))).blobs).toEqual([upload.sha256]);
    expect((await h.request(`${A}/gc?graceHours=-1`, { method: "POST" })).status).toBe(400);
  });
});

describe("an end-to-end walk", () => {
  it("upload -> create -> get -> search -> stream with Range -> ref -> release -> delete (frees blobs)", async () => {
    const blob = await h.upload("0123456789");
    const created = await asEntry(await h.send(`${A}/entries`, { type: "file", tags: ["walk"], input: { files: [{ sha256: blob.sha256, name: "digits.txt" }] } }));
    expect((await asEntry(await h.request(`${A}/entries/${created.id}`))).id).toBe(created.id);
    expect((await asList(await h.request(`${A}/entries?q=digits`))).items[0]?.id).toBe(created.id);
    expect(await (await h.request(`${A}/entries/${created.id}/files/digits.txt`, { headers: { range: "bytes=-3" } })).text()).toBe("789");
    await h.request(`${A}/entries/${created.id}/refs/memex/m1`, { method: "PUT" });
    expect((await h.request(`${A}/entries/${created.id}`, { method: "DELETE" })).status).toBe(409);
    await h.request(`${A}/entries/${created.id}/refs/memex/m1`, { method: "DELETE" });
    expect((await h.request(`${A}/entries/${created.id}`, { method: "DELETE" })).status).toBe(204);
    // Deleting freed the blobs already.
    expect(await h.archive.blobs.get(blob.sha256)).toBeNull();
    expect(await sweep({ ...h.archive, log: silentLogger }, -1000)).toEqual({ blobs: [], strays: [], tmp: 0, incoming: 0, jobs: 0 });
  });
});
