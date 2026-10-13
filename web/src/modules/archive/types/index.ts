// Registry of archive types in the UI. Typed Record<ArchiveTypeId, ...>: after
// adding an id to ArchiveTypeIdSchema, tsc fails here until the type has a form.

import type { ComponentType } from "react";
import type { Entry } from "../../../../../src/shared/archive.ts";
import { ArchiveTypeIdSchema, type ArchiveTypeId } from "../../../../../src/shared/archive-types.ts";
import type { IconName } from "../../../icons/names.ts";
import { FileAddForm } from "./file/AddForm.tsx";
import { TextAddForm } from "./text/AddForm.tsx";
import { VideoAddForm } from "./video/AddForm.tsx";
import { VideoView } from "./video/View.tsx";

export type ViewProps = { entry: Entry; previews: Record<string, string> };

export type ArchiveTypeUi = {
  label: string;
  icon: IconName;
  // Form for adding an entry of this type; navigates to the entry when done.
  AddForm: ComponentType;
  // Custom page body for entries of this type; the generic file list otherwise.
  View?: ComponentType<ViewProps>;
  // Heading of the section that holds the View ("Files" by default).
  viewHeading?: string;
};

export const archiveTypeUi: Record<ArchiveTypeId, ArchiveTypeUi> = {
  file: { label: "Text file", icon: "doc", AddForm: FileAddForm },
  text: { label: "Text", icon: "doc-text", AddForm: TextAddForm },
  video: { label: "Video", icon: "video", AddForm: VideoAddForm, View: VideoView, viewHeading: "Video" },
};

// Every type with its UI, in ArchiveTypeIdSchema's order (for menus and filters).
export const archiveTypeEntries = ArchiveTypeIdSchema.options.map((id) => [id, archiveTypeUi[id]] as const);
