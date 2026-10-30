// The element kinds' web side (their schemas: src/shared/memex-doc.ts ELEMENT_KINDS): a label and
// icon each, and how each draws (ElementBody), switched on the kind so tsc reports a kind
// without one. Adding a kind: AGENTS.md "Memex", "Add an element kind".

import { memo, useMemo, type ReactElement } from "react";
import { FONT_FAMILIES, richText, type ElementKind, type MediaElement, type PageElement, type QrElement, type TextElement } from "../../../../../src/shared/memex-doc.ts";
import { memexAssetUrl } from "../../../api.ts";
import { Icon } from "../../../icons/Icon.tsx";
import type { IconName } from "../../../icons/names.ts";
import { Halftone } from "../effects/Halftone.tsx";
import { elementLabel, pt } from "../render/units.ts";
import classes from "./Kinds.module.css";
import { encodeQr, qrPath } from "./qr/encode.ts";
import { RichText } from "./text/RichText.tsx";

export const KINDS = {
  text: { label: "Text", icon: "font" },
  image: { label: "Image", icon: "picture" },
  svg: { label: "SVG", icon: "doc" },
  excalidraw: { label: "Drawing", icon: "brush" },
  qr: { label: "QR code", icon: "qrcode" },
  frame: { label: "Empty frame", icon: "crop" },
} as const satisfies Record<ElementKind, { label: string; icon: IconName }>;

const labelText = (el: PageElement) => (el.kind === "text" ? richText(el.content) : el.kind === "qr" ? el.text : undefined);
export const labelOf = (el: PageElement) => elementLabel(el, KINDS[el.kind].label, labelText(el));

function TextBody({ el }: { el: TextElement }): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: FONT_FAMILIES[el.font].css,
        fontSize: pt(el.fontSize),
        lineHeight: el.lineHeight,
        color: el.color,
        textAlign: el.align,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}
    >
      <RichText doc={el.content} />
    </div>
  );
}

// Image, SVG and drawing all draw a file from the asset store; a halftone replaces the picture.
function MediaBody({ el }: { el: MediaElement }): ReactElement {
  const src = memexAssetUrl(el.asset);
  const halftone = el.effects.find((e) => e.type === "halftone");
  if (halftone) return <Halftone src={src} fit={el.fit} w={el.w} h={el.h} params={halftone} />;
  return <img src={src} alt="" draggable={false} style={{ display: "block", width: "100%", height: "100%", objectFit: el.fit, userSelect: "none" }} />;
}

// The modules as vector squares, square and centred in the box (crisp at any print size).
const QrBody = memo(function QrBody({ text, ecc, color, quiet }: Pick<QrElement, "text" | "ecc" | "color" | "quiet">): ReactElement {
  const drawn = useMemo((): { d: string; size: number } | { error: string } => {
    try {
      const code = encodeQr(text, ecc);
      const margin = quiet ? 4 : 0;
      return { d: qrPath(code, margin), size: code.size + 2 * margin };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [text, ecc, quiet]);
  if ("error" in drawn) return <svg width="100%" height="100%" role="img" aria-label={`QR code that could not be made: ${drawn.error}`} />;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${String(drawn.size)} ${String(drawn.size)}`} preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges" role="img" aria-label={`QR code: ${text}`}>
      <path d={drawn.d} fill={color} />
    </svg>
  );
});

// Shown only in the editor (outputs leave frames out, render/PageRender.tsx).
function FrameBody(): ReactElement {
  return (
    <div className={classes.frame}>
      <Icon name="crop" />
      <span>Drop, paste or choose an image, a drawing or a QR code</span>
    </div>
  );
}

export function ElementBody({ el }: { el: PageElement }): ReactElement {
  switch (el.kind) {
    case "text":
      return <TextBody el={el} />;
    case "image":
    case "svg":
    case "excalidraw":
      return <MediaBody el={el} />;
    case "qr":
      return <QrBody text={el.text} ecc={el.ecc} color={el.color} quiet={el.quiet} />;
    case "frame":
      return <FrameBody />;
  }
}
