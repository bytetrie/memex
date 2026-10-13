// What counts as a text file in the archive: valid UTF-8 with no binary control
// characters (NUL and most of C0; tab, newline, form feed, carriage return and
// ESC for ANSI logs are fine), and something other than whitespace in it.
// The server enforces this on the bytes; the browser runs the same check on the
// start of a file first so nobody uploads a video to be told no.

// eslint-disable-next-line no-control-regex -- finding control characters is the point
const BINARY_CONTROL = /[\u0000-\u0008\u000e-\u001a\u001c-\u001f\u007f]/;

// A reason this chunk of decoded text is not text, or null.
export function binaryReason(chunk: string): string | null {
  return BINARY_CONTROL.test(chunk) ? "contains binary data" : null;
}

export const NOT_UTF8 = "is not valid UTF-8 text";
export const EMPTY_TEXT = "has no text in it";
