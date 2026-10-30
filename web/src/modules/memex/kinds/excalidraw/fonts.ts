// Which of Excalidraw's font files a drawing's SVG needs, so they can be embedded (render.ts).
// Pure. Excalidraw splits its fonts into subsets by unicode range; a text element names its font
// and fallbacks in font-family ("Excalifont, Xiaolai, Segoe UI Emoji"), and every subset of
// those families whose range holds one of its characters is embedded. A face without a range
// covers everything.

export type FontFile = { file: string; unicodeRange?: string };
export type Manifest = Record<string, FontFile[]>;
export type FontFace = FontFile & { family: string };

// "U+20-7e, U+a0, U+0400-045F" -> [[0x20, 0x7e], [0xa0, 0xa0], [0x400, 0x45f]]
export function parseUnicodeRange(range: string): [number, number][] {
  return range.split(",").flatMap((part): [number, number][] => {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m?.[1]) return [];
    if (m[1].includes("?")) return [[parseInt(m[1].replace(/\?/g, "0"), 16), parseInt(m[1].replace(/\?/g, "f"), 16)]];
    const lo = parseInt(m[1], 16);
    return [[lo, m[2] ? parseInt(m[2], 16) : lo]];
  });
}

export const parseFamilies = (fontFamily: string) =>
  fontFamily
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

export function fontFacesFor(manifest: Manifest, uses: { families: string[]; text: string }[]): FontFace[] {
  const chars = new Map<string, Set<number>>();
  for (const use of uses) {
    for (const family of use.families) {
      if (!Object.hasOwn(manifest, family)) continue;
      const set = chars.get(family) ?? new Set<number>();
      for (const ch of use.text) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && cp > 0x1f) set.add(cp);
      }
      chars.set(family, set);
    }
  }
  const out: FontFace[] = [];
  for (const [family, set] of chars) {
    if (set.size === 0) continue;
    for (const face of new Map(Object.entries(manifest)).get(family) ?? []) {
      const ranges = face.unicodeRange ? parseUnicodeRange(face.unicodeRange) : null;
      if (!ranges || [...set].some((cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi))) out.push({ family, ...face });
    }
  }
  return out;
}
