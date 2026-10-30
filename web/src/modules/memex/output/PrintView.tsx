// /memex/print?pages=<id>,<id>&layout=single|copies: the chosen pages laid out on the sheets they
// print on (impose.ts), each sheet with its own named @page so Chromium's "Save as PDF" makes
// every page the right size, even in a mixed sequence. Outside the pane (its own route), and the
// app's sidebar hides itself in print (Shell.module.css).
//
// The outputs (ideas/printable.md): print and PDF through the browser's print dialog, and a
// standalone HTML file (exportHtml.ts) that reads as a web page on screen (FlowRender.tsx) and
// prints these same sheets. "View" switches between the two here; both are always rendered (the
// other one hidden), so the export takes them as they are.

import { Alert, Button, Group, NativeSelect, Text, Title } from "@mantine/core";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactElement } from "react";
import { z } from "zod";
import type { MemexPage } from "../../../../../src/shared/memex.ts";
import { getMemexPage } from "../../../api.ts";
import { AnchorLink } from "../../../components/AnchorLink.tsx";
import { Icon } from "../../../icons/Icon.tsx";
import { rootRoute } from "../../../root.tsx";
import { FlowRender } from "../render/FlowRender.tsx";
import { PageRender } from "../render/PageRender.tsx";
import { pt } from "../render/units.ts";
import { downloadHtml } from "./exportHtml.ts";
import { impose, LAYOUTS, type Layout } from "./impose.ts";
import classes from "./Print.module.css";

const MAX_PAGES = 200;

const VIEWS = ["sheets", "web"] as const;
const SearchSchema = z.object({
  pages: z.string().optional(),
  layout: z.enum(LAYOUTS).optional(),
  view: z.enum(VIEWS).optional(),
});

const idsOf = (pages: string | undefined) => (pages ?? "").split(",").filter((id) => z.uuid().safeParse(id).success).slice(0, MAX_PAGES);

export const memexPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memex/print",
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ pages: search.pages }),
  gcTime: 0,
  staleTime: 0,
  loader: async ({ deps }) => {
    const ids = idsOf(deps.pages);
    const found = await Promise.all(ids.map((id) => getMemexPage(id)));
    return { pages: found.filter((p): p is MemexPage => p !== null), missing: found.filter((p) => p === null).length };
  },
  component: PrintView,
});

function Sheets({ pages, layout }: { pages: MemexPage[]; layout: Layout }): ReactElement {
  const last = pages.at(-1);
  return (
    <div className={classes.sheets} data-memex-sheets data-last-page={last ? impose(last.doc.format, layout).sheet.name : undefined}>
      {pages.map((page) => {
        const { sheet, cells } = impose(page.doc.format, layout);
        const title = page.title || "Untitled";
        return (
          <section
            key={page.id}
            className={classes.sheet}
            data-memex-sheet
            data-page={sheet.name}
            aria-label={cells.length > 1 ? `${title}, ${String(cells.length)} copies on one sheet` : title}
            style={{ width: pt(sheet.w), height: pt(sheet.h) }}
          >
            {cells.map((c, i) => (
              <div key={i} data-memex-cell style={{ position: "absolute", left: pt(c.x), top: pt(c.y), width: pt(c.w), height: pt(c.h) }}>
                <PageRender doc={page.doc} title={title} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function PrintView(): ReactElement {
  const { pages, missing } = memexPrintRoute.useLoaderData();
  const search = memexPrintRoute.useSearch();
  const navigate = useNavigate();
  const layout = search.layout ?? "single";
  const view = search.view ?? "sheets";
  const sheets = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [first] = pages;
  const name = pages.length === 1 && first ? first.title || "Untitled" : `${String(pages.length)} memex pages`;

  async function exportHtml() {
    const root = sheets.current;
    if (!root) return;
    setExporting(true);
    setError(null);
    try {
      await downloadHtml(root, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={classes.view}>
      <header className={classes.bar}>
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div>
            <Title order={1} size="h3">
              Print: {name}
            </Title>
            <Text size="sm" c="dimmed">
              Choose “Save as PDF” as the printer for a PDF. Print at 100% scale (no “fit to page”), without headers and footers.
            </Text>
          </div>
          <Group gap="xs">
            <NativeSelect
              size="xs"
              label="View"
              data={[
                { value: "sheets", label: "Sheets, as printed" },
                { value: "web", label: "Web page (the HTML on screen)" },
              ]}
              value={view}
              onChange={(e) => {
                const next = SearchSchema.shape.view.safeParse(e.currentTarget.value);
                if (next.success) void navigate({ to: ".", search: (prev) => ({ ...prev, view: next.data }), replace: true });
              }}
            />
            <NativeSelect
              size="xs"
              label="Layout"
              data={[
                { value: "single", label: "One page per sheet" },
                { value: "copies", label: "Copies on Letter (2 or 4 up)" },
              ]}
              value={layout}
              onChange={(e) => {
                const next = SearchSchema.shape.layout.safeParse(e.currentTarget.value);
                if (next.success) void navigate({ to: ".", search: (prev) => ({ ...prev, layout: next.data }), replace: true });
              }}
            />
            <Button leftSection={<Icon name="print" />} onClick={() => { window.print(); }} disabled={pages.length === 0}>
              Print / Save as PDF
            </Button>
            <Button variant="light" leftSection={<Icon name="download" />} onClick={() => void exportHtml()} loading={exporting} disabled={pages.length === 0}>
              Download HTML
            </Button>
            {first && (
              <AnchorLink to="/memex/p/$pageId" params={{ pageId: first.id }} size="sm">
                Back to the editor
              </AnchorLink>
            )}
          </Group>
        </Group>
        {missing > 0 && (
          <Alert color="orange" mt="sm">
            {missing === 1 ? "One of the pages no longer exists." : `${String(missing)} of the pages no longer exist.`}
          </Alert>
        )}
        {error && (
          <Alert color="red" mt="sm" title="The HTML wasn't made">
            {error}
          </Alert>
        )}
      </header>
      {pages.length === 0 ? (
        <Text c="dimmed">No pages to print. Pick them with “Print or export…” in the memex.</Text>
      ) : (
        <div ref={sheets} data-memex-export>
          <div className={classes.web} hidden={view !== "web"}>
            <FlowRender pages={pages} />
          </div>
          <div hidden={view !== "sheets"}>
            <Sheets pages={pages} layout={layout} />
          </div>
        </div>
      )}
    </div>
  );
}
