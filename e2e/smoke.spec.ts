// Loads every sidebar component in a real browser through Caddy and fails on
// console errors, which includes CSP violations logged by web/src/main.tsx.
// Complements pnpm check:csp, which renders server-side without the headers.

import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("sidebar components load without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  const links = page.getByRole("navigation", { name: "App components" }).getByRole("link");
  await expect(links.first()).toBeVisible();

  const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  for (const [i, href] of hrefs.entries()) {
    await links.nth(i).click();
    await expect(page).toHaveURL(href);
    await expect(links.nth(i)).toHaveAttribute("aria-current", "page");
  }
  expect(errors).toEqual([]);
});

test("client routes survive a reload", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/notes");
  await expect(page.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
  expect(errors).toEqual([]);
});
