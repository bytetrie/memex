// A memex page drawn statically at its physical size: white paper, its visible elements in
// z-order (empty frames are left out), clipped to the margin (home printers can't print to the edge). The print view and the
// HTML export use it; everything is inline style, so the exported markup needs no stylesheet to
// lay out.

import { memo, type ReactElement } from "react";
import { pageDimensions, type PageDoc } from "../../../../../src/shared/memex-doc.ts";
import { ElementBody } from "../kinds/index.tsx";
import { frameStyle, PAGE_FONT, pt } from "./units.ts";

export const PageRender = memo(function PageRender({ doc, title }: { doc: PageDoc; title: string }): ReactElement {
  const { w, h } = pageDimensions(doc.format);
  const m = doc.format.margin;
  return (
    <div
      data-memex-page
      role="img"
      aria-label={title}
      style={{ position: "relative", width: pt(w), height: pt(h), overflow: "hidden", background: "#ffffff", color: "#000000", fontFamily: PAGE_FONT }}
    >
      <div style={{ position: "absolute", left: pt(m), top: pt(m), width: pt(w - 2 * m), height: pt(h - 2 * m), overflow: "hidden" }}>
        <div style={{ position: "absolute", left: pt(-m), top: pt(-m), width: pt(w), height: pt(h) }}>
          {doc.elements
            .filter((e) => !e.hidden && e.kind !== "frame")
            .map((e) => (
              <div key={e.id} style={frameStyle(e)}>
                <ElementBody el={e} />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
});
