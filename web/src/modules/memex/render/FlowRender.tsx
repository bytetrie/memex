// The pages as a web page: the HTML export's screen view (printing the file shows the sheets).
// A readable column (about 44em wide, centred, padded), each page a section, its elements in the
// rows flow.ts finds: text flows at its own sizes (in rem, 12 pt = 1rem) with no fixed box, and
// pictures and QR codes keep their proportions at their share of the page's width, wrapping onto
// their own line on a narrow screen. Inline styles only, like PageRender, so the file needs no
// stylesheet for it.

import { memo, type CSSProperties, type ReactElement } from "react";
import { FONT_FAMILIES, type PageDoc, type PageElement, type TextElement } from "../../../../../src/shared/memex-doc.ts";
import { ElementBody } from "../kinds/index.tsx";
import { RichText } from "../kinds/text/RichText.tsx";
import { flowRows } from "./flow.ts";
import { PAGE_FONT } from "./units.ts";

const rem = (pt: number) => `${String(Math.round((pt / 12) * 1000) / 1000)}rem`;

function FlowText({ el }: { el: TextElement }): ReactElement {
  return (
    <div style={{ fontFamily: FONT_FAMILIES[el.font].css, fontSize: rem(el.fontSize), lineHeight: Math.max(el.lineHeight, 1.3), color: el.color, textAlign: el.align, overflowWrap: "break-word" }}>
      <RichText doc={el.content} size={rem} />
    </div>
  );
}

function FlowItem({ el }: { el: PageElement }): ReactElement {
  const style: CSSProperties = {};
  if (el.opacity < 1) style.opacity = el.opacity;
  if (el.effects.some((e) => e.type === "grayscale")) style.filter = "grayscale(1)";
  if (el.kind === "text") {
    return (
      <div style={style}>
        <FlowText el={el} />
      </div>
    );
  }
  return (
    <div style={{ ...style, width: "100%", aspectRatio: `${String(el.w)} / ${String(el.h)}` }}>
      <ElementBody el={el} />
    </div>
  );
}

export const FlowPage = memo(function FlowPage({ doc, title }: { doc: PageDoc; title: string }): ReactElement {
  return (
    <section data-memex-flow-page aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "1.25rem", margin: "0 0 3.5rem" }}>
      {flowRows(doc).map((row, i) => (
        <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "1rem 1.5rem", alignItems: "flex-start", justifyContent: row.align === "center" ? "center" : row.align === "end" ? "flex-end" : "flex-start" }}>
          {row.items.map(({ el, share }) => (
            <div
              key={el.id}
              style={{
                // Text takes the room it has; pictures their share of the width, at most.
                flex: el.kind === "text" ? `1 1 ${String(Math.round(share * 100))}%` : `0 1 ${String(Math.round(share * 100))}%`,
                minWidth: el.kind === "text" ? "min(100%, 16rem)" : "min(100%, 8rem)",
              }}
            >
              <FlowItem el={el} />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
});

export function FlowRender({ pages }: { pages: { id: string; title: string; doc: PageDoc }[] }): ReactElement {
  return (
    <main data-memex-web style={{ boxSizing: "border-box", maxWidth: "44rem", margin: "0 auto", padding: "2.5rem 1.25rem", fontFamily: PAGE_FONT, lineHeight: 1.5, color: "#1a1a1a", background: "#ffffff" }}>
      {pages.map((p) => (
        <FlowPage key={p.id} doc={p.doc} title={p.title || "Untitled"} />
      ))}
    </main>
  );
}
