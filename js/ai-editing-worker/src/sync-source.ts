/**
 * A {@link LiveSyncSource} over the sync-service WebSocket, for headless callers
 * (the AI editing worker). Same Bebop wire protocol as the browser's
 * `service-sync` source and the old `peer.ts`, but reorganized to satisfy the
 * interface the `SyncEngine` consumes — so the worker can run the exact same
 * sync loop as a browser client instead of hand-rolling `mirror.setState`.
 *
 * Differences from the browser source: no reconnect/backoff (a worker request is
 * short-lived and online the whole time), no Solid signals, and events that
 * arrive before the engine attaches its listener are buffered and flushed on
 * `listen()` so nothing is dropped during startup.
 */
import { EphemeralStore, type PeerID, type VersionVector } from 'loro-crdt';
import { errAsync, ResultAsync } from 'neverthrow';
import type { Awareness } from '../../app/packages/core/collab/awareness';
import type { RawUpdate } from '../../app/packages/core/collab/shared';
import {
  type LiveSyncSource,
  SyncError,
  type SyncSourceEvent,
  SyncSourceStatus,
  type TimeoutError,
} from '../../app/packages/core/collab/source';
import {
  FromPeer,
  FromRemote,
  type RemoteSnapshot,
  type RemoteUpdateSince,
} from '../../app/packages/service-clients/service-sync/generated/schema';

/** The initial-sync payload the server sends right after connect. */
export type InitialSync = { snapshot: Uint8Array; awareness: Uint8Array };

const REQUEST_TIMEOUT_MS = 10_000;
const PUSH_ACK_TIMEOUT_MS = 10_000;

export class WorkerSyncSource implements LiveSyncSource {
  readonly documentId: string;

  private ws: WebSocket;
  private _status: SyncSourceStatus = SyncSourceStatus.Connecting;

  private listeners = new Set<(event: SyncSourceEvent) => void>();
  /** Events that arrive before any listener attaches; flushed on `listen()`. */
  private buffered: SyncSourceEvent[] = [];

  private initialSync: Promise<InitialSync>;
  private resolveInitial!: (sync: InitialSync) => void;
  private rejectInitial!: (err: Error) => void;

  /** Pending push acks, keyed by the update message id. */
  private pendingAcks = new Map<string, (acked: boolean) => void>();
  private pendingSnapshot?: (snapshot: Uint8Array) => void;
  private pendingSince?: (update: Uint8Array) => void;

  constructor(wsUrl: string, documentId: string, signal?: AbortSignal) {
    this.documentId = documentId;
    this.initialSync = new Promise<InitialSync>((resolve, reject) => {
      this.resolveInitial = resolve;
      this.rejectInitial = reject;
    });

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    signal?.addEventListener('abort', () => this.cleanup());

    ws.onopen = () => {
      this._status = SyncSourceStatus.Connected;
    };
    ws.onmessage = (ev: MessageEvent) => this.onMessage(ev);
    ws.onerror = () => {
      this.rejectInitial(new Error('WebSocket connection failed'));
    };
    ws.onclose = (ev: CloseEvent) => {
      this._status = SyncSourceStatus.Disconnected;
      this.rejectInitial(
        new Error(`WebSocket closed before initial sync: ${ev.code}`)
      );
      this.emit({ type: 'disconnect' });
    };
  }

  /** Resolves once the server has sent the initial snapshot. */
  waitForInitialSync(): Promise<InitialSync> {
    return this.initialSync;
  }

  private onMessage(ev: MessageEvent) {
    // Sync server sends text 'ping'; reply 'pong' to keep the connection alive.
    if (typeof ev.data === 'string') {
      if (ev.data === 'ping') this.ws.send('pong');
      return;
    }

    let msg: FromRemote;
    try {
      msg = FromRemote.decode(new Uint8Array(ev.data as ArrayBuffer));
    } catch {
      return;
    }

    if (msg.isRemoteInitialSync()) {
      const { snapshot, awareness } = msg.value as InitialSync;
      this.resolveInitial({ snapshot, awareness });
    } else if (msg.isRemoteUpdate()) {
      this.emit({
        type: 'update',
        update: (msg.value as { update: Uint8Array }).update,
      });
    } else if (msg.isRemoteAwareness()) {
      this.emit({
        type: 'awareness',
        awareness: (msg.value as { awareness: Uint8Array }).awareness,
      });
    } else if (msg.isRemoteUpdateAck()) {
      const { id } = msg.value as { id: string };
      this.pendingAcks.get(id)?.(true);
      this.pendingAcks.delete(id);
    } else if (msg.isRemoteSnapshot()) {
      this.pendingSnapshot?.((msg.value as RemoteSnapshot).snapshot);
      this.pendingSnapshot = undefined;
    } else if (msg.isRemoteUpdateSince()) {
      this.pendingSince?.((msg.value as RemoteUpdateSince).update);
      this.pendingSince = undefined;
    }
  }

  private emit(event: SyncSourceEvent) {
    if (this.listeners.size === 0) {
      this.buffered.push(event);
      return;
    }
    for (const l of this.listeners) l(event);
  }

  listen = (listener: (event: SyncSourceEvent) => void): (() => void) => {
    this.listeners.add(listener);
    // Flush anything that arrived before the engine attached.
    if (this.buffered.length > 0) {
      const pending = this.buffered;
      this.buffered = [];
      for (const event of pending) listener(event);
    }
    return () => this.listeners.delete(listener);
  };

  pushUpdate = (updates: RawUpdate[]): Promise<boolean> => {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.resolve(false);
    const id = crypto.randomUUID();
    this.ws.send(FromPeer.encode(FromPeer.fromPeerUpdate({ updates, id })));
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(id);
        resolve(false);
      }, PUSH_ACK_TIMEOUT_MS);
      this.pendingAcks.set(id, (acked) => {
        clearTimeout(timer);
        resolve(acked);
      });
    });
  };

  pushAwareness = (awareness: RawUpdate): void => {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(FromPeer.encode(FromPeer.fromPeerAwareness({ awareness })));
  };

  registerPeerId = (peerId: bigint): void => {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        FromPeer.encode(FromPeer.fromPeerRegisterId({ peerid: peerId }))
      );
    } catch {
      /* best-effort attribution */
    }
  };

  status = (): SyncSourceStatus => this._status;

  requestUpdatesSince = (
    version: VersionVector
  ): ResultAsync<RawUpdate, TimeoutError> => {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return errAsync(SyncError.timeout(REQUEST_TIMEOUT_MS));
    }
    this.ws.send(
      FromPeer.encode(FromPeer.fromPeerRequestSince({ vv: version.encode() }))
    );
    return awaitWithTimeout(
      (resolve) => (this.pendingSince = resolve),
      () => (this.pendingSince = undefined)
    );
  };

  requestSnapshot = (): ResultAsync<RawUpdate, TimeoutError> => {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return errAsync(SyncError.timeout(REQUEST_TIMEOUT_MS));
    }
    this.ws.send(FromPeer.encode(FromPeer.fromPeerRequestSnapshot({})));
    return awaitWithTimeout(
      (resolve) => (this.pendingSnapshot = resolve),
      () => (this.pendingSnapshot = undefined)
    );
  };

  reconnect = (): void => {
    // A worker request is online for its whole (short) lifetime; nothing to do.
  };

  cleanup = (): void => {
    try {
      this.ws.close(1000, 'done');
    } catch {
      /* already closed */
    }
    this.listeners.clear();
  };
}

/** Register a one-shot response resolver, bounded by a timeout, as a ResultAsync. */
function awaitWithTimeout(
  register: (resolve: (bytes: Uint8Array) => void) => void,
  clear: () => void
): ResultAsync<RawUpdate, TimeoutError> {
  return ResultAsync.fromPromise(
    new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        clear();
        reject(SyncError.timeout(REQUEST_TIMEOUT_MS));
      }, REQUEST_TIMEOUT_MS);
      register((bytes) => {
        clearTimeout(timer);
        resolve(bytes);
      });
    }),
    (e) => e as TimeoutError
  );
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
