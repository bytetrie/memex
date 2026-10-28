// The web link dialog (Mod-K, the / menu's "Web link", the selection toolbar's link button):
// an address, and the link's text when nothing is selected. Resolves with the link, with
// `href: null` to remove a link, or with null when cancelled.
// Modal with lockScroll={false}: Mantine's scroll lock injects a <style> tag, which the CSP blocks.

import { Button, Group, Modal, TextInput } from "@mantine/core";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import type { LinkAsk, LinkRequest } from "./context.ts";
import { normalizeHref } from "./webLinks.ts";

type Pending = LinkRequest & { resolve: (result: { href: string | null; text: string } | null) => void };

export function createLinkDialog() {
  let pending: Pending | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const ask: LinkAsk = (request) =>
    new Promise((resolve) => {
      pending?.resolve(null);
      pending = { ...request, resolve };
      emit();
    });
  const close = (result: { href: string | null; text: string } | null) => {
    pending?.resolve(result);
    pending = null;
    emit();
  };
  return {
    ask,
    close,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get: () => pending,
  };
}

export type LinkDialogStore = ReturnType<typeof createLinkDialog>;

function LinkForm({ request, store }: { request: Pending; store: LinkDialogStore }): ReactElement {
  const [href, setHref] = useState(request.href);
  const [text, setText] = useState(request.text);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const normalized = normalizeHref(href);
        if (!normalized) {
          setError("Enter a web address, like example.com or https://example.com/page");
          return;
        }
        store.close({ href: normalized, text: text.trim() });
      }}
    >
      <TextInput
        label="Address"
        placeholder="example.com"
        value={href}
        data-autofocus
        error={error}
        onChange={(e) => {
          setHref(e.currentTarget.value);
          setError(null);
        }}
        mb="sm"
      />
      {!request.hasSelection && (
        <TextInput
          label="Text"
          placeholder="Shown instead of the address"
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
          mb="sm"
        />
      )}
      <Group justify="flex-end" gap="xs">
        {request.href && (
          <Button variant="subtle" color="red" onClick={() => { store.close({ href: null, text: "" }); }}>
            Remove link
          </Button>
        )}
        <Button variant="default" onClick={() => { store.close(null); }}>
          Cancel
        </Button>
        <Button type="submit">{request.href ? "Save" : "Insert link"}</Button>
      </Group>
    </form>
  );
}

export function LinkDialog({ store }: { store: LinkDialogStore }): ReactElement {
  const request = useSyncExternalStore(store.subscribe, store.get);
  return (
    <Modal opened={request !== null} onClose={() => { store.close(null); }} lockScroll={false} title={request?.href ? "Edit link" : "Link to a web page"}>
      {/* Keyed so each opening starts from that request's values. */}
      {request && <LinkForm key={`${request.href}|${request.text}`} request={request} store={store} />}
    </Modal>
  );
}
