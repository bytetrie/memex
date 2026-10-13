// Page body used by every type that has no View of its own: the entry's files
// with download links and a plain-text preview (archived files are always text).

import { Anchor, Badge, Code, Text } from "@mantine/core";
import { fileUrl } from "../../api.ts";
import { Icon } from "../../icons/Icon.tsx";
import classes from "./Archive.module.css";
import { formatBytes } from "./format.ts";
import type { ViewProps } from "./types/index.ts";

export function GenericView({ entry, previews }: ViewProps) {
  return (
    <ul className={classes.list}>
      {entry.files.map((file) => {
        const url = fileUrl(entry.id, file.name);
        return (
          <li key={file.name} className={classes.fileItem}>
            <div className={classes.fileHead}>
              <Icon name="doc-text" size={18} />
              <Text fw={700}>{file.name}</Text>
              <Badge variant="outline" color="gray">
                {file.role}
              </Badge>
              <Text size="sm" c="dimmed">
                {file.mime} · {formatBytes(file.size)}
              </Text>
              <Anchor href={url} download={file.name.split("/").pop()} size="sm" aria-label={`Download ${file.name}`}>
                <Icon name="download" /> Download
              </Anchor>
            </div>
            {previews[file.name] !== undefined && (
              <Code block className={classes.preview} aria-label={`Preview of ${file.name}`}>
                {previews[file.name]}
              </Code>
            )}
          </li>
        );
      })}
    </ul>
  );
}
