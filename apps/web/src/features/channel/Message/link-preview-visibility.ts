import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

/**
 * Global "show link previews" preference (Settings → Appearance → Interface).
 * Persisted to localStorage so the preference survives reloads.
 */
export const [showLinkPreviews, setShowLinkPreviews] = makePersisted(
  createSignal<boolean>(true),
  { name: 'channel.showLinkPreviews' }
);

/** Cap so a long-lived client can't grow the hidden list unboundedly. */
const MAX_HIDDEN_ENTRIES = 500;

/**
 * Newest-last `messageId|url` keys of previews hidden on this client. Acts as
 * the optimistic layer for the sender's server-side "remove preview": entries
 * only need to survive until the rewritten content lands in the cache.
 */
const [hiddenPreviews, setHiddenPreviews] = makePersisted(
  createSignal<string[]>([]),
  { name: 'channel.hiddenLinkPreviews' }
);

function hiddenKey(messageId: string, url: string): string {
  return `${messageId}|${url}`;
}

/** Whether this message's preview of `url` was hidden locally (reactive). */
export function isLinkPreviewHidden(messageId: string, url: string): boolean {
  return hiddenPreviews().includes(hiddenKey(messageId, url));
}

/** Hides one link preview locally, ahead of server confirmation. */
export function hideLinkPreview(messageId: string, url: string): void {
  const key = hiddenKey(messageId, url);
  setHiddenPreviews((prev) =>
    [...prev.filter((entry) => entry !== key), key].slice(-MAX_HIDDEN_ENTRIES)
  );
}

/** Undo a local hide (rollback, or cleanup once server state covers it). */
export function unhideLinkPreview(messageId: string, url: string): void {
  const key = hiddenKey(messageId, url);
  setHiddenPreviews((prev) => prev.filter((entry) => entry !== key));
}

/** The URLs hidden locally for one message (reactive). */
export function hiddenUrlsForMessage(messageId: string): string[] {
  const prefix = `${messageId}|`;
  return hiddenPreviews()
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}
