// Registry of archive types. Typed Record<ArchiveTypeId, ...>: after adding an
// id to ArchiveTypeIdSchema, tsc fails here until the handler is registered.

import type { ArchiveTypeId } from "../../../shared/archive-types.ts";
import type { ArchiveTypeHandler } from "./define.ts";
import { fileType } from "./file.ts";
import { textType } from "./text.ts";
import { videoType } from "./video.ts";

export const archiveTypes: Record<ArchiveTypeId, ArchiveTypeHandler> = {
  file: fileType,
  text: textType,
  video: videoType,
};
