import { createSignal } from 'solid-js';

/**
 * Registry of share-permission refetchers for the mounted blocks. The share
 * dialog and status pill read permissions through a block resource rather
 * than a TanStack query, so mutations elsewhere (bulk item operations, the
 * snippet "Share with team" toggle) call `refetchSharePermissions` to keep
 * them in sync.
 */
const [refetchers, setRefetchers] = createSignal<(() => void)[]>([]);

/** Registers a refetcher; returns the matching unregister for `onCleanup`. */
export function registerSharePermissionsRefetch(
  refetch: () => void
): () => void {
  setRefetchers((prev) => [...prev, refetch]);
  return () => setRefetchers((prev) => prev.filter((r) => r !== refetch));
}

/** Refetches share permissions (owner, channels, link and team share) for every mounted block. */
export function refetchSharePermissions() {
  const current = refetchers();
  if (current.length === 0) {
    console.warn('no share permission refetch functions initialized');
    return;
  }
  current.forEach((refetch) => refetch());
}
