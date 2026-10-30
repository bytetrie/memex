// "QR code": the text or link and the error correction, with a preview; Insert puts the code on
// the page (into the selected empty frame, if any). Its settings stay editable in the inspector.
// lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.

import { Button, Group, Modal, NativeSelect, Text, Textarea } from "@mantine/core";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { QrEccSchema, type QrEcc } from "../../../../../../src/shared/memex-doc.ts";
import { useEditorCtx } from "../../canvas/context.ts";
import { insertQr } from "../../insert.ts";
import classes from "../../Memex.module.css";
import { ElementBody } from "../index.tsx";
import { encodeQr } from "./encode.ts";

export const ECC_LABELS = new Map<QrEcc, string>([
  ["L", "Low (7%): smallest"],
  ["M", "Medium (15%)"],
  ["Q", "Quartile (25%)"],
  ["H", "High (30%): survives the most damage"],
]);

export function QrDialog({ opened, onClose }: { opened: boolean; onClose: () => void }): ReactElement {
  const { store } = useEditorCtx();
  const [text, setText] = useState("");
  const [ecc, setEcc] = useState<QrEcc>("M");
  useEffect(() => {
    if (opened) setText("");
  }, [opened]);
  const problem = useMemo(() => {
    if (!text.trim()) return null;
    try {
      encodeQr(text, ecc);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [text, ecc]);

  return (
    <Modal opened={opened} onClose={onClose} lockScroll={false} title="QR code">
      <Textarea label="Text or link" placeholder="https://…" autosize minRows={2} maxRows={6} maxLength={2000} value={text} onChange={(e) => { setText(e.currentTarget.value); }} error={problem} data-autofocus />
      <NativeSelect
        mt="xs"
        label="Error correction"
        data={QrEccSchema.options.map((v) => ({ value: v, label: ECC_LABELS.get(v) ?? v }))}
        value={ecc}
        onChange={(e) => {
          const next = QrEccSchema.safeParse(e.currentTarget.value);
          if (next.success) setEcc(next.data);
        }}
      />
      <div className={classes.qrPreview}>
        {text.trim() && !problem ? (
          <ElementBody el={{ id: "preview", kind: "qr", text, ecc, color: "#000000", quiet: true, x: 0, y: 0, w: 1, h: 1, rotation: 0, opacity: 1, hidden: false, locked: false, effects: [] }} />
        ) : (
          <Text size="sm" c="dimmed">
            The code shows here.
          </Text>
        )}
      </div>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!text.trim() || problem !== null}
          onClick={() => {
            insertQr(store, text, ecc);
            onClose();
          }}
        >
          Insert into the page
        </Button>
      </Group>
    </Modal>
  );
}
