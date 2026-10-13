// Mime types of text files. The `file` archive type takes text only, and the
// server decides the stored type (browsers report odd ones, e.g. "" for .md).

// A Map, not an object: the extension comes from a user-supplied name, and an object lookup
// would answer "constructor" or "__proto__" with Object's own properties.
const byExtension = new Map<string, string>(Object.entries({
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  ndjson: "application/x-ndjson",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  vtt: "text/vtt",
}));

export function isTextMime(mime: string): boolean {
  return /^text\//.test(mime) || /^application\/(json|x-ndjson|yaml|toml|xml|javascript)$/.test(mime);
}

// The mime type to store for a text file: the declared one if it is a text
// type, else a guess from the extension, else text/plain (source code, logs...).
export function textMimeFor(declared: string | undefined, name: string): string {
  if (declared && isTextMime(declared)) return declared;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return byExtension.get(ext) ?? "text/plain";
}
