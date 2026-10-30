// The memex in a real browser, through Caddy, against the real app and database. Locators are
// roles and labels only (AGENTS.md "Web code"). Pages are titled "e2e-<random>" and deleted
// afterwards through the API; the assets they uploaded are detached then and swept a day later.

import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { MemexPageSchema } from "../src/shared/memex.ts";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const pages: string[] = [];
const unique = () => `e2e-${Math.random().toString(36).slice(2, 8)}`;
const pageIdFromUrl = (page: Page) => /\/memex\/p\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

test.afterEach(async ({ request }) => {
  for (const id of pages.splice(0)) await request.delete(`/api/memex/pages/${id}`);
});

// A w x h grayscale PNG, dark on the left and light on the right.
function gradientPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  const rows = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y * (w + 1) + 1 + x] = Math.round((x / (w - 1)) * 255);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

async function newPage(page: Page, title: string): Promise<string> {
  await page.goto("/memex");
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).toHaveURL(/\/memex\/p\//);
  const id = pageIdFromUrl(page);
  pages.push(id);
  await page.getByRole("textbox", { name: "Page title" }).fill(title);
  return id;
}

test("build a page, layer it, undo, halftone, print as copies and export HTML", async ({ page, request }) => {
  const errors = collectErrors(page);
  const title = unique();
  const id = await newPage(page, title);
  const readDoc = async () => MemexPageSchema.parse(await (await request.get(`/api/memex/pages/${id}`)).json()).doc;

  // Format: through Letter and back to Half Letter, with a 0.5 in margin.
  await page.getByLabel("Size").selectOption("letter");
  await page.getByLabel("Margin").selectOption("72");
  await page.getByLabel("Size").selectOption("half");
  await page.getByLabel("Margin").selectOption("36");

  // A text box, typed in place, bold, then bigger.
  await page.getByRole("button", { name: "Add text" }).click();
  const box = page.getByRole("textbox", { name: "Text box content" });
  await expect(box).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Hello zine");
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: "Bold" }).click();
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: "Done" }).click();
  const canvas = page.getByRole("group", { name: "Page canvas" });
  const text = canvas.getByRole("button", { name: "Text: Hello zine" });
  await expect(text).toBeVisible();
  await text.click();
  await page.getByLabel("Text size (pt)").fill("18");

  // An image: first its area, drawn on the page, then the file chosen into it.
  await page.getByRole("button", { name: "Add image" }).click();
  const area = await canvas.boundingBox();
  if (!area) throw new Error("the canvas has no box");
  await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.6, area.y + area.height * 0.25, { steps: 4 });
  await page.mouse.up();
  const frame = canvas.getByRole("button", { name: "Empty frame" });
  await expect(frame).toBeVisible();
  const frameBox = await frame.boundingBox();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose an image…" }).click();
  await (await chooser).setFiles({ name: "gradient.png", mimeType: "image/png", buffer: gradientPng(64, 32) });
  const image = canvas.getByRole("button", { name: "Image" });
  await expect(image).toBeVisible();
  await expect(frame).toHaveCount(0);
  // Fitted inside the drawn area with its 2:1 proportions.
  const imageBox = await image.boundingBox();
  if (!frameBox || !imageBox) throw new Error("no boxes");
  expect(imageBox.width / imageBox.height).toBeCloseTo(2, 1);
  expect(imageBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);

  // Dragged with the mouse (it is selected and on top after adding it).
  const x0 = Number(await page.getByLabel("X (pt)").inputValue());
  const at = await image.boundingBox();
  if (!at) throw new Error("the image has no box");
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 80, at.y + at.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel("X (pt)").inputValue())).toBeGreaterThan(x0 + 30);

  // Layers: top first; send the image down, undo, redo.
  const layers = page.getByRole("list", { name: "Layers, top first" }).getByRole("listitem");
  await expect(layers).toHaveText(["Image", "Text: Hello zine"]);
  await page.getByRole("toolbar", { name: "Selected layers" }).getByRole("button", { name: "Send backward" }).click();
  await expect(layers).toHaveText(["Text: Hello zine", "Image"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(layers).toHaveText(["Image", "Text: Hello zine"]);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(layers).toHaveText(["Text: Hello zine", "Image"]);

  // Halftone on the image.
  await page.getByRole("list", { name: "Layers, top first" }).getByRole("button", { name: "Image", exact: true }).click();
  await page.getByRole("button", { name: "Halftone" }).click();
  const dots = canvas.getByRole("img", { name: "Halftone" });
  await expect(dots).toHaveAttribute("data-halftone", "ready");

  // Saved: the text with its bold mark and size, the image under it with its halftone.
  await expect
    .poll(async () => {
      const doc = await readDoc();
      return [doc.format.size, doc.format.margin, ...doc.elements.map((e) => `${e.kind}:${e.effects.map((x) => x.type).join("+")}`)];
    }, { timeout: 10_000 })
    .toEqual(["half", 36, "image:halftone", "text:"]);
  const saved = await readDoc();
  expect(JSON.stringify(saved.elements.find((e) => e.kind === "text"))).toContain('"bold"');
  expect(saved.elements.find((e) => e.kind === "text")).toMatchObject({ fontSize: 18 });

  // The print view, as 2 copies on a Letter sheet.
  await page.getByRole("button", { name: "Print this page" }).click();
  await expect(page).toHaveURL(/\/memex\/print\?/);
  await page.getByLabel("Layout").selectOption("copies");
  const sheet = page.getByRole("region", { name: `${title}, 2 copies on one sheet` });
  await expect(sheet.getByRole("img", { name: title })).toHaveCount(2);
  await expect(sheet.getByRole("img", { name: "Halftone" }).first()).toHaveAttribute("data-halftone", "ready");

  // The web view of the same page, as the HTML file shows it on screen.
  await page.getByLabel("View").selectOption("web");
  await expect(page.getByRole("region", { name: title })).toBeVisible();
  await expect(page.getByRole("region", { name: title }).getByText("Hello zine")).toBeVisible();

  // The HTML file: every page, the images inlined, nothing fetched from elsewhere.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML" }).click();
  const file = await (await download).path();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the temp file Playwright saved the download to
  const html = await readFile(file, "utf8");
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain(`<title>${title}</title>`);
  expect(html).toContain("Hello zine");
  expect(html.match(/data-memex-sheet=/g)).toHaveLength(1);
  expect(html.match(/data-memex-page=/g)).toHaveLength(2);
  expect(html.match(/data-memex-flow-page=/g)).toHaveLength(1);
  expect(html).toContain("@page letter-landscape");
  expect(html).not.toMatch(/(src|href)="\/|url\(\/|\/api\//);
  expect(html).toContain('font-family: "TeX Gyre Heros"; src: url("data:');
  expect(errors).toEqual([]);

  // Opened as a file: a flowing web page on screen, the sheets in print.
  const copy = test.info().outputPath("export.html");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this test's own output folder
  await writeFile(copy, html);
  await page.goto(`file://${copy}`);
  const web = page.getByRole("main");
  await expect(web.getByRole("region", { name: title })).toBeVisible();
  const width = await web.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(800);
  await expect(page.getByRole("region", { name: `${title}, 2 copies on one sheet` })).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("region", { name: `${title}, 2 copies on one sheet` })).toBeVisible();
  await expect(web).toBeHidden();
});

test("paste an SVG and an Excalidraw drawing, tag the page and find it", async ({ page, request }) => {
  const errors = collectErrors(page);
  const title = unique();
  const id = await newPage(page, title);
  const paste = (text: string) =>
    page.evaluate((t) => {
      const data = new DataTransfer();
      data.setData("text/plain", t);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    }, text);
  // Focus off the title field: pastes into fields stay in them.
  await page.getByRole("group", { name: "Page canvas" }).click({ position: { x: 5, y: 5 } });

  await paste('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" onload="alert(1)"><script>alert(2)</script><rect width="80" height="40" fill="#333"/></svg>');
  const layers = page.getByRole("list", { name: "Layers, top first" }).getByRole("listitem");
  await expect(layers).toHaveText(["SVG"]);

  const scene = {
    type: "excalidraw/clipboard",
    elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 120, height: 60, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, roughness: 1, opacity: 100, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: null, angle: 0 }],
    files: {},
  };
  await paste(JSON.stringify(scene));
  await expect(layers).toHaveText(["Drawing", "SVG"], { timeout: 20_000 });

  await expect
    .poll(async () => MemexPageSchema.parse(await (await request.get(`/api/memex/pages/${id}`)).json()).doc.elements.map((e) => e.kind), { timeout: 10_000 })
    .toEqual(["svg", "excalidraw"]);
  // The SVG went up without its script and handler.
  const doc = MemexPageSchema.parse(await (await request.get(`/api/memex/pages/${id}`)).json()).doc;
  const svg = doc.elements.find((e) => e.kind === "svg");
  const body = await (await request.get(`/api/memex/assets/${svg && "asset" in svg ? svg.asset : ""}`)).text();
  expect(body).toContain("<rect");
  expect(body).not.toMatch(/script|onload/);

  const tag = unique();
  await page.getByRole("combobox", { name: "Tags" }).fill(tag);
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Search" }).fill(`#${tag}`);
  await expect(page.getByRole("navigation", { name: "Matching pages" }).getByRole("link")).toHaveText([`${title}Half`]);
  expect(errors).toEqual([]);
});

test("a mixed sequence prints each page at its own size, with no blank pages", async ({ page, request }) => {
  const errors = collectErrors(page);
  const ids: string[] = [];
  for (const [size, orientation] of [["letter", "portrait"], ["half", "portrait"], ["quarter", "landscape"]] as const) {
    const res = await request.post("/api/memex/pages", { data: { title: unique(), doc: { format: { size, orientation, margin: 36 }, grid: { step: 9, show: false, snap: true }, elements: [] } } });
    const created = MemexPageSchema.parse(await res.json());
    ids.push(created.id);
    pages.push(created.id);
  }
  const mediaBoxes = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/MediaBox \[([^\]]*)\]/g)].map((m) => m[1]?.trim());

  await page.goto(`/memex/print?pages=${ids.join(",")}`);
  await expect(page.getByRole("region")).toHaveCount(3);
  expect(mediaBoxes(await page.pdf({ preferCSSPageSize: true }))).toEqual(["0 0 612 792", "0 0 396 612", "0 0 396 306"]);

  // As copies: the Half page 2-up on landscape Letter, the Quarter one 4-up on landscape Letter.
  await page.getByLabel("Layout").selectOption("copies");
  await expect(page.getByRole("region", { name: /4 copies on one sheet$/ })).toBeVisible();
  expect(mediaBoxes(await page.pdf({ preferCSSPageSize: true }))).toEqual(["0 0 612 792", "0 0 792 612", "0 0 792 612"]);
  expect(errors).toEqual([]);
});

test("draw in the scratch pad and edit the drawing, a QR code in a frame, a serif text box", async ({ page, request }) => {
  const errors = collectErrors(page);
  const id = await newPage(page, unique());
  const readDoc = async () => MemexPageSchema.parse(await (await request.get(`/api/memex/pages/${id}`)).json()).doc;
  const layers = page.getByRole("list", { name: "Layers, top first" }).getByRole("listitem");
  const canvas = page.getByRole("group", { name: "Page canvas" });

  // A rectangle drawn in Excalidraw, inserted as an SVG.
  const drawRectangle = async (dx: number) => {
    const pad = page.getByRole("dialog", { name: /^(Draw|Edit the drawing)$/ });
    await pad.getByRole("radio", { name: /Rectangle/ }).check({ force: true });
    const box = await pad.boundingBox();
    if (!box) throw new Error("no dialog box");
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx + 120, box.y + box.height / 2 + 80, { steps: 5 });
    await page.mouse.up();
  };
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByRole("dialog", { name: "Draw" })).toBeVisible();
  await drawRectangle(0);
  await page.getByRole("button", { name: "Insert into the page" }).click();
  await expect(layers).toHaveText(["Drawing"], { timeout: 20_000 });
  await expect.poll(async () => (await readDoc()).elements.map((e) => e.kind), { timeout: 10_000 }).toEqual(["excalidraw"]);
  const first = (await readDoc()).elements[0];
  if (first?.kind !== "excalidraw") throw new Error("no drawing");
  expect((await request.get(`/api/memex/assets/${first.asset}`)).headers()["content-type"]).toBe("image/svg+xml");

  // Opened again on its scene, changed and updated in place.
  await canvas.getByRole("button", { name: "Drawing" }).dblclick();
  await expect(page.getByRole("dialog", { name: "Edit the drawing" })).toBeVisible();
  await drawRectangle(-200);
  await page.getByRole("button", { name: "Update the drawing" }).click();
  await expect.poll(async () => {
    const el = (await readDoc()).elements[0];
    return el?.kind === "excalidraw" ? el.asset : "";
  }, { timeout: 20_000 }).not.toBe(first.asset);
  await expect(layers).toHaveText(["Drawing"]);

  // A frame, filled with a QR code.
  await page.getByRole("button", { name: "Add image" }).click();
  const area = await canvas.boundingBox();
  if (!area) throw new Error("no canvas box");
  await page.mouse.move(area.x + area.width * 0.55, area.y + area.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.85, area.y + area.height * 0.3, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "QR code here…" }).click();
  await page.getByRole("textbox", { name: "Text or link" }).fill("https://example.com/memex");
  await page.getByRole("button", { name: "Insert into the page" }).click();
  await expect(layers).toHaveText(["QR code: https://example.com/memex", "Drawing"]);
  await expect(canvas.getByRole("img", { name: "QR code: https://example.com/memex" })).toBeVisible();

  // A text box set in the serif face.
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Font", { exact: true }).selectOption("serif");
  await expect.poll(async () => (await readDoc()).elements.map((e) => (e.kind === "text" ? `text:${e.font}` : e.kind)), { timeout: 10_000 }).toEqual(["excalidraw", "qr", "text:serif"]);
  expect(errors).toEqual([]);
});
