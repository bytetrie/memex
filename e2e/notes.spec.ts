// Notes in a real browser, through Caddy, against the real app and database. Locators are roles
// and labels only (AGENTS.md "Web code"). Every page and archive entry is titled "e2e-<random>"
// and deleted afterwards through the API, pages first (they hold refs on the entries). Only this
// worker's own data: the real notes stay untouched.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { EntrySchema } from "../src/shared/archive.ts";
import type { Doc } from "../src/shared/notes-doc.ts";
import { DrawingSchema, PageSchema } from "../src/shared/notes.ts";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const pages: string[] = [];
const entries: string[] = [];
const unique = () => `e2e-${Math.random().toString(36).slice(2, 8)}`;
// A word that appears nowhere else.
const token = () => `zq${Math.random().toString(36).slice(2, 8)}`;

async function apiPage(request: APIRequestContext, title: string, doc?: Doc) {
  const res = await request.post("/api/notes/pages", { data: { title, doc } });
  expect(res.status()).toBe(201);
  const page = PageSchema.parse(await res.json());
  pages.push(page.id);
  return page;
}

async function apiTextEntry(request: APIRequestContext, title: string, body: string) {
  const res = await request.post("/api/archive/entries", { data: { type: "text", input: { text: `# ${title}\n\n${body}` } } });
  expect(res.status()).toBe(201);
  const entry = EntrySchema.parse(await res.json());
  entries.push(entry.id);
  return entry;
}

const readPage = async (request: APIRequestContext, id: string) => PageSchema.parse(await (await request.get(`/api/notes/pages/${id}`)).json());
const pageIdFromUrl = (page: Page) => /\/notes\/p\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
const editorOf = (page: Page) => page.getByRole("textbox", { name: "Page content" });

test.afterEach(async ({ request }) => {
  for (const id of pages.splice(0)) await request.delete(`/api/notes/pages/${id}`);
  for (const id of entries.splice(0)) await request.delete(`/api/archive/entries/${id}`);
});

test("create a page, write markdown, and find it again after a reload", async ({ page, request }) => {
  const errors = collectErrors(page);
  const title = unique();
  const word = token();

  await page.goto("/notes");
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).toHaveURL(/\/notes\/p\//);
  const id = pageIdFromUrl(page);
  pages.push(id);

  await page.getByRole("textbox", { name: "Page title" }).fill(title);
  await editorOf(page).click();
  await page.keyboard.type(`## Section ${word}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- first item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second item");

  await expect.poll(async () => (await readPage(request, id)).title, { timeout: 10_000 }).toBe(title);
  await expect.poll(async () => JSON.stringify((await readPage(request, id)).doc), { timeout: 10_000 }).toContain("second item");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(title);
  await expect(editorOf(page).getByRole("heading", { name: `Section ${word}`, level: 2 })).toBeVisible();
  await expect(editorOf(page).getByRole("listitem")).toHaveText(["first item", "second item"]);
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");

  // Search in the pane finds it by a word of its text.
  await page.getByRole("textbox", { name: "Search" }).fill(word);
  await expect(page.getByRole("navigation", { name: "Matching pages" }).getByRole("link")).toHaveText([title]);
  expect(errors).toEqual([]);
});

test("link to a page and to a block, follow the links, see the backlinks", async ({ page, request }) => {
  const errors = collectErrors(page);
  const targetTitle = unique();
  const word = token();
  const target = await apiPage(request, targetTitle, {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "intro" }, content: [{ type: "text", text: "intro" }] },
      { type: "paragraph", attrs: { id: "the-block" }, content: [{ type: "text", text: `the block with ${word}` }] },
    ],
  });
  const source = await apiPage(request, unique());

  await page.goto(`/notes/p/${source.id}`);
  await editorOf(page).click();
  await page.keyboard.type(`[[${targetTitle}`);
  await page.getByRole("listbox", { name: "Link to a page" }).getByRole("option", { name: targetTitle }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type(`((${word}`);
  await page.getByRole("listbox", { name: "Link to a block" }).getByRole("option", { name: word }).waitFor();
  await page.keyboard.press("Enter");

  await expect(editorOf(page).getByRole("link", { name: targetTitle, exact: true })).toBeVisible();
  const blockLink = editorOf(page).getByRole("link", { name: `${targetTitle} › the block with ${word}` });
  await expect(blockLink).toBeVisible();
  await expect.poll(async () => JSON.stringify((await readPage(request, source.id)).doc), { timeout: 10_000 }).toContain("the-block");

  await blockLink.click();
  await expect(page).toHaveURL((url) => url.pathname === `/notes/p/${target.id}` && url.hash === "#the-block");
  await expect(editorOf(page).getByText(`the block with ${word}`)).toBeVisible();
  const backlinks = page.getByRole("region", { name: "Linked from" });
  await expect(backlinks.getByRole("link", { name: source.title, exact: true })).toHaveCount(1);
  // Each place on the source page that links here opens the source at that block.
  const places = backlinks.getByRole("list", { name: `Where ${source.title} links here` }).getByRole("link");
  await expect(places).toHaveCount(1);
  await places.click();
  await expect(page).toHaveURL((url) => url.pathname === `/notes/p/${source.id}` && url.hash.length > 1);
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(source.title);
  expect(errors).toEqual([]);
});

test("embed an archive entry; typing doesn't re-render it; the entry is held by a ref", async ({ page, request }) => {
  const errors = collectErrors(page);
  const word = token();
  const entry = await apiTextEntry(request, unique(), `excerpt ${word}`);
  const note = await apiPage(request, unique(), { type: "doc", content: [{ type: "paragraph", attrs: { id: "a" } }] });

  await page.goto(`/notes/p/${note.id}`);
  await editorOf(page).click();
  await page.keyboard.type("/archive"); // a space would close the menu
  await page.getByRole("listbox", { name: "Insert a block" }).getByRole("option", { name: "Archive entry", exact: true }).waitFor();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Embed an archive entry" });
  await dialog.getByRole("textbox", { name: "Search the archive" }).fill(entry.title);
  await dialog.getByRole("button", { name: entry.title }).click();
  await expect(dialog).toBeHidden();

  const excerpt = editorOf(page).getByText(`excerpt ${word}`);
  await expect(excerpt).toBeVisible();
  // Mark the rendered DOM node, type elsewhere, and check it is still the same node.
  await excerpt.evaluate((el) => {
    el.setAttribute("data-e2e-mark", "1");
  });
  await editorOf(page).getByRole("paragraph").first().click();
  await page.keyboard.type("typing above the embed");
  await expect(editorOf(page).getByText("typing above the embed")).toBeVisible();
  await expect(editorOf(page).locator("[data-e2e-mark]")).toContainText(`excerpt ${word}`);

  // Once saved, the archive refuses to delete the entry.
  await expect.poll(async () => EntrySchema.parse(await (await request.get(`/api/archive/entries/${entry.id}`)).json()).refs.length, { timeout: 10_000 }).toBe(1);
  expect((await request.delete(`/api/archive/entries/${entry.id}`)).status()).toBe(409);
  expect(errors).toEqual([]);
});

test("draw in a drawing block; it is still there after a reload", async ({ page, request }) => {
  const errors = collectErrors(page);
  const note = await apiPage(request, unique(), { type: "doc", content: [{ type: "paragraph", attrs: { id: "a" } }] });

  await page.goto(`/notes/p/${note.id}`);
  await editorOf(page).click();
  await page.keyboard.type("/drawing");
  await page.getByRole("listbox", { name: "Insert a block" }).getByRole("option", { name: "Drawing" }).waitFor();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Edit" }).click();

  const canvas = page.locator("canvas.excalidraw__canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no drawing canvas");
  await page.getByRole("radio", { name: "Rectangle" }).check({ force: true }); // the icon covers the radio
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 180, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("img", { name: "Drawing" })).toBeVisible();

  // The page saved the block, the drawing saved its scene.
  await expect.poll(async () => JSON.stringify((await readPage(request, note.id)).doc), { timeout: 10_000 }).toContain("drawingId");
  const drawingId = /"drawingId":"([0-9a-f-]{36})"/.exec(JSON.stringify((await readPage(request, note.id)).doc))?.[1] ?? "";
  await expect
    .poll(async () => DrawingSchema.parse(await (await request.get(`/api/notes/drawings/${drawingId}`)).json()).scene.elements.length, { timeout: 10_000 })
    .toBe(1);
  await page.reload();
  await expect(page.getByRole("img", { name: "Drawing" })).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("saving doesn't move the page; a block link scrolls to its block", async ({ page, request }) => {
  const errors = collectErrors(page);
  const content = Array.from({ length: 80 }, (_, i) => ({ type: "paragraph", attrs: { id: `b${String(i)}` }, content: [{ type: "text", text: `line ${String(i)}` }] }));
  const note = await apiPage(request, unique(), { type: "doc", content });

  await page.goto(`/notes/p/${note.id}`);
  // Under load, the window can still be scrolling into place when the click lands (the cursor
  // then ends up elsewhere): click until the cursor is in the line.
  await expect(async () => {
    await editorOf(page).getByText("line 79").click();
    expect(await page.evaluate(() => window.getSelection()?.anchorNode?.textContent)).toBe("line 79");
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Insert a block" })).toBeVisible();
  await expect.poll(async () => JSON.stringify((await readPage(request, note.id)).doc), { timeout: 10_000 }).toContain('"/"');
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  await page.keyboard.press("Escape");
  await page.goto(`/notes/p/${note.id}#b60`);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test("web links: [text](address), Ctrl+K; leaving a code block", async ({ page, request }) => {
  const errors = collectErrors(page);
  const note = await apiPage(request, unique());

  await page.goto(`/notes/p/${note.id}`);
  await editorOf(page).click();
  await page.keyboard.type("see [the search](google.com) here");
  await expect(editorOf(page).getByRole("link", { name: "the search" })).toHaveAttribute("href", "https://google.com");

  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Link to a web page" });
  await dialog.getByRole("textbox", { name: "Address" }).fill("example.com/page");
  await dialog.getByRole("textbox", { name: "Text" }).fill("Example");
  await dialog.getByRole("button", { name: "Insert link" }).click();
  await expect(editorOf(page).getByRole("link", { name: "Example" })).toHaveAttribute("href", "https://example.com/page");

  await page.keyboard.press("Enter");
  await page.keyboard.type("``` ");
  await page.keyboard.type("let x = 1");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("after the code");
  await expect(editorOf(page).getByRole("paragraph").filter({ hasText: "after the code" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("code blocks: Tab and Enter indent, three Enters leave, the code is coloured", async ({ page, request }) => {
  const errors = collectErrors(page);
  const note = await apiPage(request, unique());

  await page.goto(`/notes/p/${note.id}`);
  await editorOf(page).click();
  await page.keyboard.type("``` ");
  await page.keyboard.type("if (x) {");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y()");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("z");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("after the code");
  await expect(editorOf(page).getByRole("paragraph").filter({ hasText: "after the code" })).toBeVisible();
  expect(await editorOf(page).evaluate((el) => el.querySelectorAll("pre span[class]").length)).toBeGreaterThan(0);

  const code = async () => {
    const block = (await readPage(request, note.id)).doc.content?.find((n) => n.type === "codeBlock");
    return block?.content?.map((t) => t.text ?? "").join("") ?? null;
  };
  await expect.poll(code, { timeout: 10_000 }).toBe("if (x) {\n  y()\n    z");
  expect(errors).toEqual([]);
});

test("link an archive entry from the keyboard", async ({ page, request }) => {
  const errors = collectErrors(page);
  const entry = await apiTextEntry(request, unique(), "linked by keyboard");
  const note = await apiPage(request, unique());

  await page.goto(`/notes/p/${note.id}`);
  await editorOf(page).click();
  await page.keyboard.type("/archive");
  await page.getByRole("listbox", { name: "Insert a block" }).getByRole("option", { name: "Link to an archive entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Link to an archive entry" });
  await dialog.getByRole("textbox", { name: "Search the archive" }).fill(entry.title);
  const result = dialog.getByRole("button", { name: entry.title });
  await expect(result).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(result).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(dialog.getByRole("textbox", { name: "Search the archive" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(async () => JSON.stringify((await readPage(request, note.id)).doc), { timeout: 10_000 }).toContain(entry.id);
  expect(errors).toEqual([]);
});

test("the front page opens the notes, which reopen the page last viewed", async ({ page, request }) => {
  const errors = collectErrors(page);
  const note = await apiPage(request, unique());

  await page.goto("/");
  await expect(page).toHaveURL(/\/notes$/);
  await page.goto(`/notes/p/${note.id}`);
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(note.title);
  await page.goto("/");
  await expect(page).toHaveURL(`/notes/p/${note.id}`);
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(note.title);
  expect(errors).toEqual([]);
});

test("the pane: fold it, filter by a tag and clear it, delete a page from its menu", async ({ page, request }) => {
  const errors = collectErrors(page);
  const tag = token();
  const note = await apiPage(request, unique());
  await request.patch(`/api/notes/pages/${note.id}`, { data: { tags: [tag] } });

  await page.goto(`/notes/p/${note.id}`);
  await page.getByRole("button", { name: "Hide the pages" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeHidden();
  await page.getByRole("button", { name: "Show the pages" }).click();

  await page.getByRole("link", { name: `${tag}: show only pages with this tag` }).click();
  await expect(page.getByRole("navigation", { name: "Matching pages" }).getByRole("link", { name: note.title })).toBeVisible();
  await page.getByRole("button", { name: "Show all pages" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  await expect(page).toHaveURL((url) => !url.searchParams.has("tag"));

  await page.getByRole("button", { name: `Actions for ${note.title}` }).click();
  await page.getByRole("menuitem", { name: "Delete page" }).click();
  await page.getByRole("dialog", { name: "Delete this page?" }).getByRole("button", { name: "Delete page" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/notes");
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: note.title })).toHaveCount(0);
  expect((await request.get(`/api/notes/pages/${note.id}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("the drag handle stays while the pointer moves onto it, and moves the block", async ({ page, request }) => {
  const errors = collectErrors(page);
  const note = await apiPage(request, unique(), {
    type: "doc",
    content: ["first", "second", "third"].map((t) => ({ type: "paragraph", attrs: { id: t }, content: [{ type: "text", text: `${t} block` }] })),
  });

  await page.goto(`/notes/p/${note.id}`);
  const third = editorOf(page).getByText("third block");
  const box = await third.boundingBox();
  if (!box) throw new Error("no block");
  // The handle is mouse-only (aria-hidden), so it is found by its tooltip text.
  const handle = page.getByTitle("Drag to move this block, click to select it");
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await expect(handle).toBeVisible();
  const grip = await handle.boundingBox();
  if (!grip) throw new Error("no handle");
  // Slowly, the way a hand does: every pixel between the text and the grip.
  await page.mouse.move(grip.x + 10, grip.y + grip.height / 2, { steps: Math.ceil(box.x + 20 - grip.x) });
  await expect(handle).toBeVisible();

  const first = await editorOf(page).getByText("first block").boundingBox();
  if (!first) throw new Error("no block");
  await page.mouse.down();
  await page.mouse.move(first.x + 20, first.y + 2, { steps: 10 });
  await page.mouse.up();
  await expect(editorOf(page).getByRole("paragraph")).toHaveText(["third block", "first block", "second block"]);
  expect(errors).toEqual([]);
});
