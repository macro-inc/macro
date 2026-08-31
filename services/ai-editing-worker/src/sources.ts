/**
 * Glue for headless callers (the AI editing worker): builds the shared
 * `SyncServiceSource` over a static-URL socket, plus a minimal `Awareness` for
 * AI peer attribution. The wire protocol itself lives in `service-sync` and is
 * shared with the browser — nothing is reimplemented here.
 */

import type { Awareness } from '@macro-inc/collaboration/collab/awareness';
import type {
  InitialSync,
  TimeoutError,
} from '@macro-inc/collaboration/collab/source';
import {
  FromPeer,
  FromRemote,
  type IFromPeer,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import {
  createSyncSocket,
  type SyncWebsocket,
} from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import {
  BebopSerializer,
  WebsocketEvent,
  type WebsocketSerializer,
} from '@macro-inc/collaboration/websocket';
import { EphemeralStore, type PeerID } from 'loro-crdt';
import { ResultAsync } from 'neverthrow';
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
 * How long the worker waits for the server-pushed `RemoteInitialSync` before
 * actively requesting a snapshot over the same socket. The server normally
 * sends it well under 100ms after the socket opens, so 2s only triggers when
 * the push is genuinely lost.
 */
const INITIAL_SYNC_FALLBACK_MS = 2_000;

/** Inert message: every guard is false, so listeners and waiters ignore it. */
const POISON_FRAME: FromRemote = {
  isRemoteInitialSync: () => false,
  isRemoteUpdate: () => false,
  isRemoteAwareness: () => false,
  isRemoteSnapshot: () => false,
  isRemoteUpdateAck: () => false,
  isRemoteUpdateSince: () => false,
} as unknown as FromRemote;

/**
 * Bebop serializer whose deserialize failures don't take the socket down.
 *
 * A deserialize exception escapes the transport wrapper's message listener
 * into the runtime's event dispatch, which errors out the WebSocket without a
 * close event — leaving a zombie socket that never retries and can't carry
 * the snapshot fallback (observed on prod/dev as `raw_frames=1 decoded=0
 * errors=1`). Swallow the failure, report it to diagnostics, and hand the
 * wrapper an inert message instead, so the socket stays usable and the
 * fallback still runs.
 */
export function createTolerantSerializer(
  onFailure: (error: unknown) => void
): WebsocketSerializer<IFromPeer, FromRemote> {
  const base = new BebopSerializer<IFromPeer, FromRemote>(FromPeer, FromRemote);
  return {
    serialize: (data) => base.serialize(data),
    deserialize: (data) => {
      try {
        return base.deserialize(data as ArrayBuffer);
      } catch (error) {
        console.error('sync frame failed to deserialize; dropping it:', error);
        onFailure(error);
        return POISON_FRAME;
      }
    },
    binaryType: base.binaryType,
  };
}

/**
 * {@link SyncServiceSource} with a worker-only bootstrap fallback.
 *
 * The server pushes `RemoteInitialSync` from inside the `/connect` request
 * handler. On Cloudflare that send races the hibernation manager reclaiming
 * the socket when the request context ends, and a workerd regression
 * (STOR-5552; fixed by cloudflare/workerd#7163, follow-up #7147) silently
 * dropped sends caught in that handover: the socket stayed open but the
 * snapshot never arrived, and every worker edit died on
 * "initial sync failed: timeout (10000ms)".
 *
 * When the push stays silent for {@link INITIAL_SYNC_FALLBACK_MS}, this
 * subclass sends `PeerRequestSnapshot` and bootstraps from the
 * `RemoteSnapshot` reply (with empty awareness — the worker never reads it).
 * That reply is served from the message handler on the manager-owned socket,
 * which does not cross the affected boundary. First success wins; browsers
 * keep the plain push-based flow.
 */
export class WorkerSyncSource extends SyncServiceSource {
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(socket: SyncWebsocket, documentId: string) {
    super(socket, documentId);
    // Both are assignable instance properties on the base class; capture the
    // originals, then wrap.
    const withFallback = this.raceWithSnapshotFallback(
      this.doInitialSync(),
      socket
    );
    this.doInitialSync = () => withFallback;
    const baseCleanup = this.cleanup;
    this.cleanup = () => {
      this.cancelFallback();
      baseCleanup();
    };
  }

  private raceWithSnapshotFallback(
    initial: ResultAsync<InitialSync, TimeoutError>,
    socket: SyncWebsocket
  ): ResultAsync<InitialSync, TimeoutError> {
    const fallback = new Promise<InitialSync>((resolve, reject) => {
      this.fallbackTimer = setTimeout(() => {
        this.fallbackTimer = undefined;
        console.warn(
          `no initial sync after ${INITIAL_SYNC_FALLBACK_MS}ms; requesting snapshot fallback:`,
          this.documentId
        );
        this.requestSnapshot().match((snapshot) => {
          // The base class only unlocks pushUpdate and starts the heartbeat
          // when RemoteInitialSync arrives; the fallback bootstrap must do
          // both itself. Both are safe if the push arrives later anyway.
          this.initialSyncReceived = true;
          socket.startHeartbeat();
          resolve({ snapshot, awareness: new Uint8Array(0) });
        }, reject);
      }, INITIAL_SYNC_FALLBACK_MS);
    });
    // First success wins. When both fail, surface the first error (the
    // original initial-sync timeout), matching the push-only failure shape.
    return ResultAsync.fromPromise(
      new Promise<InitialSync>((resolve, reject) => {
        let failures = 0;
        let firstError: TimeoutError | undefined;
        const fail = (error: TimeoutError) => {
          firstError ??= error;
          failures += 1;
          if (failures === 2) reject(firstError);
        };
        void initial.match((sync) => {
          this.cancelFallback();
          resolve(sync);
        }, fail);
        fallback.then(resolve, (error) => fail(error as TimeoutError));
      }),
      (error) => error as TimeoutError
    );
  }

  private cancelFallback(): void {
    if (this.fallbackTimer === undefined) return;
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }
}

/**
 * A {@link WorkerSyncSource} bound to a fixed, token-bearing URL. A worker
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
  const serializer = createTolerantSerializer((error) =>
    diagnostics?.recordDecodeFailure(error)
  );
  const ws = createSyncSocket(() => wsUrl, diagnostics?.factory, serializer);
  if (diagnostics) {
    // The wrapper only dispatches Message after a successful deserialize, so
    // raw frames (from the factory) minus these are frames that failed decode.
    ws.addEventListener(WebsocketEvent.Message, (_ws, event) =>
      diagnostics.recordDecoded(remoteMessageKind(event.data))
    );
  }
  const source = new WorkerSyncSource(ws, documentId);
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
