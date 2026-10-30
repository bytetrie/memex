// The page last opened in this browser, so /notes (and the app's front page) reopens it. A
// convenience kept in localStorage, which may be missing or throw; forgotten when that page is
// deleted or no longer exists.

import { z } from "zod";

const KEY = "memex.notes.lastPage";

export function lastPage(): string | null {
  try {
    const id = z.uuid().safeParse(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
    return id.success ? id.data : null;
  } catch {
    return null;
  }
}

export function rememberLastPage(pageId: string): void {
  try {
    localStorage.setItem(KEY, pageId);
  } catch {
    // not remembered, that's all
  }
}

export function forgetLastPage(pageId: string): void {
  try {
    if (localStorage.getItem(KEY) === pageId) localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
