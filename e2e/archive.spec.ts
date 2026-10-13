// The archive in a real browser, through Caddy, against the real app and
// database. Locators are roles and labels only: a control without an
// accessible name fails here instead of slipping through (AGENTS.md "Web code").
// Every entry is titled "e2e-<random>" and deleted afterwards through the API, and every search
// the tests run is removed from the recent searches again. Only this worker's own entries and
// searches: workers run in parallel on the same data, and the real history must stay untouched.
// Searches use words that are unique to the run, never generic ones.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { EntryListSchema } from "../src/shared/archive.ts";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const created: string[] = [];
function unique(): string {
  const name = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  created.push(name);
  return name;
}

async function deleteMyEntries(request: APIRequestContext) {
  for (const name of created.splice(0)) {
    const list = await request.get(`/api/archive/entries?q=${encodeURIComponent(name)}&limit=100`);
    const { items } = EntryListSchema.parse(await list.json());
    for (const entry of items.filter((e) => e.title.includes(name))) await request.delete(`/api/archive/entries/${entry.id}`);
  }
}

// A word that appears nowhere else, for searching by content.
const token = () => `zq${Math.random().toString(36).slice(2, 8)}`;

const searches: { query: string; type?: string }[] = [];

// Runs a search through the form and remembers it for cleanup. `type` is the type filter selected at the time.
async function searchFor(page: Page, query: string, type?: string) {
  searches.push({ query, type });
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

async function removeMySearches(request: APIRequestContext) {
  for (const { query, type } of searches.splice(0)) {
    await request.delete("/api/archive/searches", { params: type ? { query, type } : { query } });
  }
}

test.afterEach(async ({ request }) => {
  await deleteMyEntries(request);
  await removeMySearches(request);
});

test("add text, tag it, find it by search, open it, delete it", async ({ page }) => {
  const errors = collectErrors(page);
  const title = unique();
  const word = token(); // in the body only, not in the title

  await page.goto("/archive");
  await expect(page.getByRole("heading", { name: "Archive", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Add text" })).toBeVisible();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill(`# ${title}\n\nbody with ${word}`);
  await page.getByRole("button", { name: "Add to archive" }).click();

  // On the entry page: the title comes from the first line.
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Preview of content.md")).toContainText(`body with ${word}`);
  await page.getByRole("combobox", { name: "Tags" }).fill("e2e");
  await page.getByRole("combobox", { name: "Tags" }).press("Enter");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  // Find it again: by the filter chips and by search.
  await page.getByRole("link", { name: "Back to archive" }).click();
  await expect(page.getByRole("heading", { name: "Recent additions" })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // Mantine's Chip hides its radio input (people click the label), so click it by event.
  await page.getByRole("radio", { name: "Text file" }).dispatchEvent("click");
  await expect(page.getByRole("radio", { name: "Text file" })).toBeChecked();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  await page.getByRole("radio", { name: "Text", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  // The body is searchable too (the title does not contain the word).
  await searchFor(page, word, "text");
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

  // Delete (two steps).
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/archive$/);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("upload a file, see its preview, and the search is remembered", async ({ page }) => {
  const errors = collectErrors(page);
  const name = `${unique()}.txt`;

  await page.goto("/archive/new/file");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Files" }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from("file body from e2e") });
  await page.getByRole("button", { name: "Add to archive" }).click();

  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByLabel(`Preview of ${name}`)).toContainText("file body from e2e");
  await expect(page.getByRole("link", { name: `Download ${name}` })).toHaveAttribute("href", /\/files\//);

  await page.getByRole("link", { name: "Back to archive" }).click();
  const query = name.slice(0, 6);
  await searchFor(page, query);
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible(); // not before: leaving aborts the request
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.goto("/archive");
  await expect(page.getByRole("heading", { name: "Recent searches" })).toBeVisible();
  await expect(page.getByRole("link", { name: query, exact: true })).toBeVisible();

  // A recent search can be removed again.
  await page.getByRole("button", { name: `Remove search ${query}`, exact: true }).click();
  await expect(page.getByRole("link", { name: query, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("only text files can be added: a binary file is refused before anything is stored", async ({ page }) => {
  const name = `${unique()}.png`;
  const uploads: string[] = [];
  page.on("request", (req) => req.method() === "PUT" && uploads.push(req.url()));

  await page.goto("/archive/new/file");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Files" }).click();
  // A PNG signature: not valid UTF-8.
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]) });
  await page.getByRole("button", { name: "Add to archive" }).click();

  await expect(page.getByRole("alert")).toHaveText(`${name} is not valid UTF-8 text; only text files can be added`);
  await expect(page).toHaveURL(/\/archive\/new\/file$/);
  expect(uploads).toEqual([]); // the server refuses non-text too: see archive.test.ts
});

test("a JSON file is previewed as text and found by its content", async ({ page }) => {
  const name = `${unique()}.json`;
  const word = token();
  await page.goto("/archive/new/file");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Files" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(`{"colour": "${word}"}`) });
  await page.getByRole("button", { name: "Add to archive" }).click();

  await expect(page.getByLabel(`Preview of ${name}`)).toContainText(word);
  await page.getByRole("link", { name: "Back to archive" }).click();
  await searchFor(page, word);
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("#tags in the search box: every tag has to match", async ({ page, request }) => {
  const name = unique();
  const [tagA, tagB] = [`${name}-a`, `${name}-b`];
  for (const [title, tags] of [[`${name}-both`, [tagA, tagB]], [`${name}-one`, [tagA]]] as const) {
    const res = await request.post("/api/archive/entries", { data: { type: "text", title, tags, input: { text: `text of ${title}` } } });
    expect(res.status()).toBe(201);
  }
  const search = page.getByRole("textbox", { name: "Search", exact: true });

  await page.goto("/archive");
  await searchFor(page, `#${tagA}`);
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("link", { name: `${name}-both` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${name}-one` })).toBeVisible();

  await searchFor(page, `#${tagA} #${tagB}`);
  await expect(page).toHaveURL((url) => url.href.includes(tagB)); // the second search has landed
  await expect(page.getByRole("link", { name: `${name}-both` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${name}-one` })).toHaveCount(0);

  // A tag on a result is a link that searches for it.
  await searchFor(page, name);
  await expect(page).toHaveURL((url) => url.href.includes(`q=${name}`));
  await page.getByRole("link", { name: `Tag ${tagB}` }).click();
  await expect(search).toHaveValue(`#${tagB}`);
  await expect(page.getByRole("link", { name: `${name}-both` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${name}-one` })).toHaveCount(0);
});

test("unknown entries and types show not-found pages", async ({ page }) => {
  await page.goto("/archive/e/019a0000-0000-7000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await page.goto("/archive/new/nonsense");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
