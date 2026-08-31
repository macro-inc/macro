/**
 * Glue for headless callers (the AI editing worker): builds the shared
 * `SyncServiceSource` over a static-URL socket, plus a minimal `Awareness` for
 * AI peer attribution. The wire protocol itself lives in `service-sync` and is
 * shared with the browser — nothing is reimplemented here.
 */

import type { Awareness } from '@macro-inc/collaboration/collab/awareness';
import type { FromRemote } from '@macro-inc/collaboration/sync-service/generated/schema';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { EphemeralStore, type PeerID } from 'loro-crdt';
import type { SyncSocketDiagnostics } from './sync-diagnostics';

function remoteMessageKind(message: FromRemote): string {
  if (message.isRemoteInitialSync()) return 'initial_sync';
  if (message.isRemoteUpdate()) return 'update';
  if (message.isRemoteAwareness()) return 'awareness';
  if (message.isRemoteSnapshot()) return 'snapshot';
  if (message.isRemoteUpdateAck()) return 'update_ack';
  if (message.isRemoteUpdateSince()) return 'update_since';
  return 'unknown';
}

/**
 * A {@link SyncServiceSource} bound to a fixed, token-bearing URL. A worker
 * request is short-lived and online for its whole life, so every (re)connect
 * resolves to the same URL. Closes the socket on `signal` abort.
 *
 * When `diagnostics` is given, the underlying socket is created through its
 * observing factory and decoded messages are counted, so a sync timeout can
 * report how far the connection got.
 */
export function createWorkerSyncSource(
  wsUrl: string,
  documentId: string,
  signal?: AbortSignal,
  diagnostics?: SyncSocketDiagnostics
): SyncServiceSource {
  const ws = createSyncSocket(() => wsUrl, diagnostics?.factory);
  if (diagnostics) {
    // The wrapper only dispatches Message after a successful deserialize, so
    // raw frames (from the factory) minus these are frames that failed decode.
    ws.addEventListener(WebsocketEvent.Message, (_ws, event) =>
      diagnostics.recordDecoded(remoteMessageKind(event.data))
    );
  }
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
