// What a person types in the search box: words and #tags ("report 2026 #work #urgent").
// Words are prefix matches that must all match (toTsQuery); every #tag must be on the entry.
// A tag containing spaces is quoted: #"my tag". Tags are compared in lower case, like stored tags.

export function parseSearch(input: string): { words: string; tags: string[] } {
  const tags: string[] = [];
  const words = input.replace(/(^|\s)#(?:"([^"]*)"|(\S*))/g, (_match, lead: string, quoted?: string, bare?: string) => {
    const tag = (quoted ?? bare ?? "").trim().toLowerCase();
    if (tag) tags.push(tag);
    return lead;
  });
  return { words, tags: [...new Set(tags)] };
}

// Turns words into a Postgres tsquery: every word is a prefix match and all words must match
// ("rep pdf" -> "rep:* & pdf:*"). Only letters and digits survive, which also makes the result
// safe for to_tsquery.

export function toTsQuery(input: string): string | null {
  const words = input.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}
