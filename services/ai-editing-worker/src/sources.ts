/**
 * Glue for headless callers (the AI editing worker): builds the shared
 * `SyncServiceSource` over a static-URL socket, plus a minimal `Awareness` for
 * AI peer attribution. The wire protocol itself lives in `service-sync` and is
 * shared with the browser — nothing is reimplemented here.
 */

import type { Awareness } from '@core/collab/awareness';
import { createSyncSocket } from '@service-sync/source/socket';
import { SyncServiceSource } from '@service-sync/source/source';
import { EphemeralStore, type PeerID } from 'loro-crdt';

/**
 * A {@link SyncServiceSource} bound to a fixed, token-bearing URL. A worker
 * request is short-lived and online for its whole life, so every (re)connect
 * resolves to the same URL. Closes the socket on `signal` abort.
 */
export function createWorkerSyncSource(
  wsUrl: string,
  documentId: string,
  signal?: AbortSignal
): SyncServiceSource {
  const ws = createSyncSocket(() => wsUrl);
  const source = new SyncServiceSource(ws, documentId);
  signal?.addEventListener('abort', () => source.cleanup());
  return source;
}

export function createWorkerAwareness(peerId: PeerID): Awareness<unknown> {
  const store = new EphemeralStore(30_000);
  return {
    local: () => ({
      user: { userId: undefined, color: '', peerId },
      selection: undefined,
    }),
    remote: () => [],
    updateLocalAwareness: (selection) => {
      if (selection === undefined) store.delete(peerId);
      else store.set(peerId, selection as never);
    },
    updateRemoteAwareness: () => {},
    importRemoteAwareness: (update) => {
      try {
        store.apply(update);
      } catch {
        /* drop malformed awareness */
      }
    },
    getEncodedLocalAwareness: () => store.encodeAll(),
  };
}
