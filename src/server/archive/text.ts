// Decides whether stored bytes are a text file (rules: src/shared/text.ts) and
// returns the start of the text for the search index. Streams, so a large file
// is checked without being held in memory.

import { EMPTY_TEXT, NOT_UTF8, binaryReason } from "../../shared/text.ts";
import type { ByteStream } from "./ports.ts";

export type TextInspection = { ok: true; head: string } | { ok: false; reason: string };

// `headChars`: how much of the beginning to keep.
export async function inspectText(stream: ByteStream, headChars: number): Promise<TextInspection> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = stream.getReader();
  let head = "";
  let hasText = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk: string;
      try {
        chunk = decoder.decode(value, { stream: true });
      } catch {
        return { ok: false, reason: NOT_UTF8 };
      }
      const binary = binaryReason(chunk);
      if (binary) return { ok: false, reason: binary };
      if (chunk.trim() !== "") hasText = true;
      if (head.length < headChars) head += chunk.slice(0, headChars - head.length);
    }
    try {
      decoder.decode(); // flushes: a file ending inside a multi-byte character is invalid
    } catch {
      return { ok: false, reason: NOT_UTF8 };
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return hasText ? { ok: true, head } : { ok: false, reason: EMPTY_TEXT };
}
