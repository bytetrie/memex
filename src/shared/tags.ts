// Tags, as both the archive and notes validate them. The two keep separate tags (their own tables);
// only the rule is shared: trimmed, lower case, 1-64 characters, at most 50 on one item.

import { z } from "zod";

export const TagSchema = z.string().trim().toLowerCase().min(1).max(64);
export const TagsSchema = z.array(TagSchema).max(50);
