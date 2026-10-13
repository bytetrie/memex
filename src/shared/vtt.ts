// WebVTT subtitles -> cues of plain text. Used by the server (a video's transcript becomes search
// text) and the browser (the transcript list under the player). Input is untrusted: tags are
// stripped, never interpreted, and the number of cues is capped.

export type Cue = { start: number; end: number; text: string };

// "01:02:03.456" or "02:03.456" -> seconds; null if malformed.
export function parseTimestamp(value: string): number | null {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const [secPart = "", ...rest] = parts.reverse();
  if (!/^\d{2}\.\d{3}$/.test(secPart) || !rest.every((p) => /^\d{1,4}$/.test(p))) return null;
  const [min = "0", hours = "0"] = rest;
  return Number(hours) * 3600 + Number(min) * 60 + Number(secPart);
}

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&nbsp;", " "],
]);

function cueText(lines: string[]): string {
  return lines
    .map((l) => l.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES.get(e) ?? e).trim())
    .filter((l) => l !== "")
    .join("\n");
}

export function parseVtt(text: string, maxCues = 50_000): Cue[] {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length && cues.length < maxCues; i++) {
    // eslint-disable-next-line security/detect-object-injection -- a numeric index into an array
    const line = lines[i] ?? "";
    if (!line.includes("-->")) continue;
    const [from = "", , to = ""] = line.trim().split(/\s+/);
    const start = parseTimestamp(from);
    const end = parseTimestamp(to);
    const body: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1] ?? "").trim() !== "") body.push(lines[++i] ?? "");
    const textOfCue = cueText(body);
    if (start !== null && end !== null && textOfCue !== "") cues.push({ start, end, text: textOfCue });
  }
  return cues;
}

// YouTube's automatic captions roll: each cue repeats the line before it and short cues repeat
// whole lines. Keeps only the lines not shown just before, so the text reads once.
export function dedupeCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  const recent: string[] = [];
  for (const cue of cues) {
    const fresh = cue.text.split("\n").filter((l) => !recent.includes(l));
    if (fresh.length === 0) continue;
    out.push({ start: cue.start, end: cue.end, text: fresh.join(" ") });
    recent.push(...fresh);
    recent.splice(0, Math.max(0, recent.length - 4));
  }
  return out;
}

export const transcriptCues = (vtt: string) => dedupeCues(parseVtt(vtt));
