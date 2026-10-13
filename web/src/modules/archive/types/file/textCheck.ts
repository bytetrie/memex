// Early check in the browser that a chosen file is text, so a video isn't uploaded just to be
// refused. The server runs the same rules on the whole file and is the one that decides.

import { binaryReason, EMPTY_TEXT, NOT_UTF8 } from "../../../../../../src/shared/text.ts";

const SAMPLE_BYTES = 64 * 1024;

// A reason the file is not a text file, or null if the start of it looks like text.
export async function notTextReason(file: File): Promise<string | null> {
  if (file.size === 0) return EMPTY_TEXT;
  const bytes = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    // `stream` lets the sample end inside a multi-byte character; only a whole file is checked for that.
    const text = decoder.decode(bytes, { stream: bytes.length < file.size });
    return binaryReason(text) ?? (text.trim() === "" && file.size <= SAMPLE_BYTES ? EMPTY_TEXT : null);
  } catch {
    return NOT_UTF8;
  }
}
