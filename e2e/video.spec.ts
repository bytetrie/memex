// Video entries in a real browser, through Caddy, against the real app and database (see
// archive.spec.ts for the rules). Every job a test queues is dismissed afterwards, and every entry
// is titled "e2e-<random>" and deleted. Downloads need the internet, so the full download-and-play
// test only runs when E2E_VIDEO_URL names a short video
// (E2E_VIDEO_URL=https://... pnpm test:e2e e2e/video.spec.ts; at least 20 s long, for the
// resume and bookmark steps in a note page, which is deleted before the entry); the rest stays offline.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { JobListSchema } from "../src/shared/archive-jobs.ts";
import { EntryListSchema } from "../src/shared/archive.ts";
import { PageSchema } from "../src/shared/notes.ts";

const unique = () => `e2e-${Math.random().toString(36).slice(2, 8)}`;
const myTitles: string[] = [];
const myUrls: string[] = [];
const myPages: string[] = [];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function cleanUp(request: APIRequestContext) {
  // Pages first: they hold refs on the entries.
  for (const id of myPages.splice(0)) await request.delete(`/api/notes/pages/${id}`);
  const jobs = JobListSchema.parse(await (await request.get("/api/archive/jobs?status=queued,running,failed,done,cancelled&limit=200")).json());
  for (const job of jobs.items.filter((j) => typeof j.input.url === "string" && myUrls.includes(j.input.url))) {
    if (job.status === "queued" || job.status === "running") await request.post(`/api/archive/jobs/${job.id}/cancel`);
  }
  for (const job of jobs.items.filter((j) => typeof j.input.url === "string" && myUrls.includes(j.input.url))) {
    for (let i = 0; i < 20; i++) {
      if ((await request.delete(`/api/archive/jobs/${job.id}`)).status() !== 409) break;
      await new Promise((resolve) => setTimeout(resolve, 500)); // a cancelled job is still stopping
    }
  }
  for (const title of myTitles.splice(0)) {
    const { items } = EntryListSchema.parse(await (await request.get(`/api/archive/entries?q=${encodeURIComponent(title)}&limit=100`)).json());
    for (const entry of items.filter((e) => e.title === title)) await request.delete(`/api/archive/entries/${entry.id}`);
  }
  myUrls.length = 0;
}

test.afterEach(async ({ request }) => {
  await cleanUp(request);
});

async function openVideoForm(page: Page) {
  await page.goto("/archive");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Video", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add video", level: 1 })).toBeVisible();
}

test("the video form refuses anything but an https URL", async ({ page }) => {
  const errors = collectErrors(page);
  await openVideoForm(page);
  await page.getByRole("textbox", { name: "Video page URL" }).fill("http://example.com/watch");
  await page.getByRole("button", { name: "Queue download" }).click();
  await expect(page.getByText("Enter the video page's https:// address.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a download that fails shows its error, and can be retried and dismissed", async ({ page }) => {
  const errors = collectErrors(page);
  // .invalid never resolves: the job fails whether or not the runners are there.
  const url = `https://${unique()}.invalid/watch?v=1`;
  myUrls.push(url);
  await openVideoForm(page);
  await page.getByRole("textbox", { name: "Video page URL" }).fill(url);
  await page.getByRole("button", { name: "Queue download" }).click();

  const job = page.getByRole("list", { name: "Video downloads" }).getByRole("listitem", { name: `Job: ${url}` });
  await expect(job).toBeVisible();
  await expect(job.getByRole("alert")).toBeVisible({ timeout: 60_000 });
  await expect(job.getByText("Failed", { exact: true })).toBeVisible();

  // Queuing the same URL again while it is listed as failed is allowed (only active ones block).
  await job.getByRole("button", { name: `Retry ${url}` }).click();
  await expect(job.getByRole("alert")).toBeVisible({ timeout: 60_000 });

  // The archive page lists the failure too.
  await page.goto("/archive");
  const listed = page.getByRole("list", { name: "Jobs" }).getByRole("listitem", { name: `Job: ${url}` });
  await expect(listed).toBeVisible();
  await listed.getByRole("button", { name: `Dismiss ${url}` }).click();
  await expect(listed).toHaveCount(0);
  expect(errors).toEqual([]);
});

const videoUrl = process.env.E2E_VIDEO_URL;
test("download a video, play it, see its card preview, resume and bookmark it in a note", async ({ page, request }) => {
  test.skip(!videoUrl, "set E2E_VIDEO_URL to a short video to run this (needs the internet and the runners)");
  test.setTimeout(10 * 60_000);
  const url = videoUrl ?? "";
  const title = unique();
  myUrls.push(url);
  myTitles.push(title);
  const errors = collectErrors(page);

  await openVideoForm(page);
  await page.getByRole("textbox", { name: "Video page URL" }).fill(url);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("button", { name: "Queue download" }).click();
  const job = page.getByRole("list", { name: "Video downloads" }).getByRole("listitem", { name: `Job: ${title}` });
  await job.getByRole("link", { name: "Open the entry" }).click({ timeout: 9 * 60_000 });

  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const entryId = /\/archive\/e\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const video = page.getByRole("region", { name: "Video" }).locator("video");
  await expect(video).toBeVisible();
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);

  // The card shows the thumbnail and switches to the animated preview on hover.
  await page.goto(`/archive?q=${encodeURIComponent(title)}`);
  const thumb = page.getByRole("img", { name: `Thumbnail of ${title}` });
  await expect(thumb).toBeVisible();
  await thumb.hover();
  await expect(page.getByRole("img", { name: `Animated preview of ${title}` })).toBeVisible();

  // Embedded in a note page, the video offers to resume where it was left (remembered per browser)
  // and keeps labelled bookmarks (saved with the page).
  const res = await request.post("/api/notes/pages", {
    data: { title: unique(), doc: { type: "doc", content: [{ type: "archiveEmbed", attrs: { id: "v", entryId } }] } },
  });
  const note = PageSchema.parse(await res.json());
  myPages.push(note.id);
  await page.goto(`/notes/p/${note.id}`);
  const embedded = page.getByLabel(`Video: ${title}`);
  await expect(embedded).toBeVisible();
  const duration = await embedded.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    v.currentTime = 6;
    await new Promise((resolve) => {
      v.addEventListener("seeked", resolve, { once: true });
    });
    v.pause();
    return v.duration;
  });
  expect(duration, "E2E_VIDEO_URL must be at least 20 s long").toBeGreaterThan(20);

  await page.reload();
  await page.getByRole("button", { name: /^Resume at 0:0[67]$/ }).click();
  await expect.poll(() => embedded.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  await embedded.evaluate((v: HTMLVideoElement) => {
    v.pause();
  });

  await page.getByRole("button", { name: "Add bookmark" }).click();
  await page.getByRole("textbox", { name: /^Bookmark label/ }).fill("e2e intro");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => JSON.stringify(PageSchema.parse(await (await request.get(`/api/notes/pages/${note.id}`)).json()).doc), { timeout: 10_000 }).toContain("e2e intro");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
  await page.getByRole("button", { name: /^Jump to 0:0[67]: e2e intro$/ }).click();
  await expect.poll(() => embedded.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  expect(errors).toEqual([]);
});
