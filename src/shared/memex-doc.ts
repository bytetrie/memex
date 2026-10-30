// A memex page's content: a fixed-size printable sheet holding positioned elements, stored as one
// JSON document (memex_pages.doc). Design: ideas/printable.md.
//
// - Geometry is in points (1/72 in), measured from the page's top-left corner. Every renderer
//   (editor, print view, exported HTML) draws in CSS `pt`, so sizes are physical.
// - `elements` is in z-order: the first is at the back, the last on top (the layers panel).
// - Three registries keep the model open for later features: element kinds (ELEMENT_KINDS, one
//   schema each), effects (EFFECTS) and outputs (web/src/modules/memex/output/). Adding one means
//   adding a schema here and its renderer in the web app; tsc lists what is missing.
// - The server reads a doc only through analyzePageDoc(): its text (search) and its assets.

import { z } from "zod";
import { DocSchema as RichTextSchema, type DocNode } from "./notes-doc.ts";

// --- page format ---------------------------------------------------------------------------

export const PageSizeSchema = z.enum(["letter", "half", "quarter"]);
export type PageSize = z.infer<typeof PageSizeSchema>;

// Portrait dimensions in points. Landscape swaps them.
export const PAGE_SIZES = {
  letter: { w: 612, h: 792, label: "US Letter" },
  half: { w: 396, h: 612, label: "Half Letter" },
  quarter: { w: 306, h: 396, label: "Quarter Letter" },
} as const satisfies Record<PageSize, { w: number; h: number; label: string }>;

export const OrientationSchema = z.enum(["portrait", "landscape"]);
export type Orientation = z.infer<typeof OrientationSchema>;

// 0.25 in, 0.5 in, 1 in.
export const MARGINS = [18, 36, 72] as const;
export const MarginSchema = z.union([z.literal(18), z.literal(36), z.literal(72)]);
export type Margin = z.infer<typeof MarginSchema>;

export const FormatSchema = z.object({ size: PageSizeSchema, orientation: OrientationSchema, margin: MarginSchema });
export type Format = z.infer<typeof FormatSchema>;

export function pageDimensions(format: Pick<Format, "size" | "orientation">): { w: number; h: number } {
  const { w, h } = PAGE_SIZES[format.size];
  return format.orientation === "portrait" ? { w, h } : { w: h, h: w };
}

export const GridSchema = z.object({
  step: z.number().min(2).max(144),
  show: z.boolean(),
  snap: z.boolean(),
});
export type Grid = z.infer<typeof GridSchema>;

// --- effects -------------------------------------------------------------------------------

// Non-destructive, applied in list order when rendering. Each has its params here and a
// renderer in web/src/modules/memex/effects/.
export const GrayscaleEffectSchema = z.object({ type: z.literal("grayscale") });
export const HalftoneShapeSchema = z.enum(["circle", "square"]);
export const HalftoneEffectSchema = z.object({
  type: z.literal("halftone"),
  // Distance between dot centres, in points.
  cell: z.number().min(1.5).max(48),
  // Screen angle in degrees (45 is the classic one for black).
  angle: z.number().min(0).max(90),
  shape: HalftoneShapeSchema,
  // Dots for the light parts instead of the dark ones.
  invert: z.boolean(),
});
export const EffectSchema = z.discriminatedUnion("type", [GrayscaleEffectSchema, HalftoneEffectSchema]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect["type"];
export type HalftoneEffect = z.infer<typeof HalftoneEffectSchema>;
export const MAX_EFFECTS = 8;
export const EFFECT_TYPES = ["grayscale", "halftone"] as const satisfies readonly EffectType[];

// --- elements ------------------------------------------------------------------------------

export const ElementIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "an element id");
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "a sha256 hex digest");

// Far enough off the page to park things, small enough to keep numbers sane.
const Coord = z.number().min(-5000).max(5000);
const Length = z.number().min(1).max(5000);

const BaseElementSchema = z.object({
  id: ElementIdSchema,
  x: Coord,
  y: Coord,
  w: Length,
  h: Length,
  // Degrees, clockwise, around the element's centre.
  rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  hidden: z.boolean(),
  locked: z.boolean(),
  name: z.string().trim().max(100).optional(),
  effects: z.array(EffectSchema).max(MAX_EFFECTS),
});

export const TEXT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72, 96, 120, 144] as const;
export const TextAlignSchema = z.enum(["left", "center", "right"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

// The type faces a text box can use, self-hosted (web/src/fonts.css): TeX Gyre Heros (sans),
// Termes (serif) and Cursor (monospace), each with bold and italic.
export const FontFamilySchema = z.enum(["sans", "serif", "mono"]);
export type FontFamily = z.infer<typeof FontFamilySchema>;
export const FONT_FAMILIES = {
  sans: { label: "Sans serif", css: "'TeX Gyre Heros', 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  serif: { label: "Serif", css: "'TeX Gyre Termes', 'Times New Roman', Times, serif" },
  mono: { label: "Monospace", css: "'TeX Gyre Cursor', 'Courier New', Courier, monospace" },
} as const satisfies Record<FontFamily, { label: string; css: string }>;

// Node and mark names in a text box's content (ProseMirror JSON from the box's Tiptap editor).
// Paragraphs carry attrs.align, the `size` mark attrs.pt (one of TEXT_SIZES), the `font` mark
// attrs.family (a FontFamily).
export const TEXT_NODES = { paragraph: "paragraph", text: "text", hardBreak: "hardBreak" } as const;
export const TEXT_MARKS = { bold: "bold", italic: "italic", underline: "underline", size: "size", font: "font" } as const;

export const TextElementSchema = BaseElementSchema.extend({
  kind: z.literal("text"),
  content: RichTextSchema,
  // Face and size of text without a font or size mark (size in points).
  font: FontFamilySchema.default("sans"),
  fontSize: z.number().min(4).max(400),
  lineHeight: z.number().min(0.8).max(3),
  align: TextAlignSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const ImageFitSchema = z.enum(["contain", "cover", "fill"]);
export type ImageFit = z.infer<typeof ImageFitSchema>;

// A raster image (PNG, JPEG, WebP, GIF, AVIF) uploaded to the memex asset store.
export const ImageElementSchema = BaseElementSchema.extend({ kind: z.literal("image"), asset: Sha256Schema, fit: ImageFitSchema });
// An SVG, sanitised before upload and only ever shown through <img>.
export const SvgElementSchema = BaseElementSchema.extend({ kind: z.literal("svg"), asset: Sha256Schema, fit: ImageFitSchema });
// A drawing from Excalidraw (the scratch pad, or pasted from a notes drawing): `asset` is its
// rendering (a self-contained SVG; PNG for drawings made before that), `scene` the scene JSON it
// was rendered from, so it can be opened and edited again.
export const ExcalidrawElementSchema = BaseElementSchema.extend({ kind: z.literal("excalidraw"), asset: Sha256Schema, scene: Sha256Schema, fit: ImageFitSchema });

// A QR code of `text` (UTF-8, byte mode), drawn as vector modules at the box's size. `quiet`
// keeps the standard 4-module blank border inside the box.
export const QrEccSchema = z.enum(["L", "M", "Q", "H"]);
export type QrEcc = z.infer<typeof QrEccSchema>;
export const QrElementSchema = BaseElementSchema.extend({
  kind: z.literal("qr"),
  text: z.string().min(1).max(2000),
  ecc: QrEccSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  quiet: z.boolean(),
});

// An empty area drawn on the page for something to go in (an image, a drawing, a QR code, text):
// whatever is dropped, pasted or chosen into it takes its place, fitted inside it. Shown only
// while editing; outputs leave it out.
export const FrameElementSchema = BaseElementSchema.extend({ kind: z.literal("frame") });

export const ELEMENT_KINDS = ["text", "image", "svg", "excalidraw", "qr", "frame"] as const;
export const ElementSchema = z.discriminatedUnion("kind", [TextElementSchema, ImageElementSchema, SvgElementSchema, ExcalidrawElementSchema, QrElementSchema, FrameElementSchema]);
export type PageElement = z.infer<typeof ElementSchema>;
export type ElementKind = PageElement["kind"];
export type ElementOf<K extends ElementKind> = Extract<PageElement, { kind: K }>;
export type TextElement = ElementOf<"text">;
export type MediaElement = ElementOf<"image" | "svg" | "excalidraw">;

export type QrElement = ElementOf<"qr">;
export const isMedia = (e: PageElement): e is MediaElement => e.kind === "image" || e.kind === "svg" || e.kind === "excalidraw";

// Which effects apply to which kinds (halftone needs pixels, so not text).
export const EFFECTS = {
  grayscale: { label: "Grayscale", kinds: ELEMENT_KINDS },
  halftone: { label: "Halftone", kinds: ["image", "svg", "excalidraw"] },
} as const satisfies Record<EffectType, { label: string; kinds: readonly ElementKind[] }>;

// eslint-disable-next-line security/detect-object-injection -- `type` is an EffectType, a closed union validated by EffectSchema
export const effectApplies = (type: EffectType, kind: ElementKind): boolean => (EFFECTS[type].kinds as readonly ElementKind[]).includes(kind);

// --- the page doc --------------------------------------------------------------------------

export const MAX_ELEMENTS = 500;

export const PageDocSchema = z
  .object({
    format: FormatSchema,
    grid: GridSchema,
    elements: z.array(ElementSchema).max(MAX_ELEMENTS),
  })
  .refine((d) => new Set(d.elements.map((e) => e.id)).size === d.elements.length, "element ids must be unique");
export type PageDoc = z.infer<typeof PageDocSchema>;

export const defaultFormat = (): Format => ({ size: "half", orientation: "portrait", margin: 36 });

export const emptyPageDoc = (format: Format = defaultFormat()): PageDoc => ({
  format,
  grid: { step: 9, show: false, snap: true },
  elements: [],
});

// Plain text of a text box, paragraphs on their own lines.
export function richText(node: DocNode): string {
  if (node.type === TEXT_NODES.text) return node.text ?? "";
  if (node.type === TEXT_NODES.hardBreak) return "\n";
  const inner = (node.content ?? []).map(richText);
  return node.type === TEXT_NODES.paragraph ? inner.join("") : inner.join("\n");
}

export type PageDocAnalysis = {
  // Text of every text box, for search and snippets.
  text: string;
  // Every asset the page uses (an element's file, an Excalidraw scene), sorted and unique.
  assets: string[];
};

export function analyzePageDoc(doc: PageDoc): PageDocAnalysis {
  const texts: string[] = [];
  const assets = new Set<string>();
  for (const e of doc.elements) {
    if (e.kind === "text") {
      const t = richText(e.content).trim();
      if (t) texts.push(t);
    } else if (e.kind === "qr") {
      texts.push(e.text);
    } else if (isMedia(e)) {
      assets.add(e.asset);
      if (e.kind === "excalidraw") assets.add(e.scene);
    }
  }
  return { text: texts.join("\n\n"), assets: [...assets].sort() };
}
