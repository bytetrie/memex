export function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  let value = n / 1024;
  let unit = "KB";
  for (const next of ["MB", "GB", "TB"]) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}

// A tag as typed in the search box: #work, or #"my tag" when it has spaces.
export const tagToken = (tag: string) => (/\s/.test(tag) ? `#"${tag}"` : `#${tag}`);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// 75 -> "1:15", 3725 -> "1:02:05"
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${s}` : `${String(m)}:${s}`;
}
