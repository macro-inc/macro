import { logSyncService } from '@core/collab/logger';
import type { RawUpdate } from '@core/collab/shared';
import {
  type InitialSync,
  type LiveSyncSource,
  SyncError,
  type SyncSourceEvent,
  SyncSourceStatus,
  type TimeoutError,
} from '@core/collab/source';
import { arrayEquals } from '@core/util/compareUtils';
import {
  WebsocketConnectionState,
  WebsocketEvent,
  type WebsocketEventListener,
} from '@websocket';
import type { VersionVector } from 'loro-crdt';
import { ResultAsync } from 'neverthrow';
import {
  FromPeer,
  type FromRemote,
  type IFromPeer,
  type RemoteSnapshot,
  type RemoteUpdateSince,
} from '../generated/schema';
import type { SyncSocket } from './socket';

export const TIMEOUTS = {
  INITIAL_SYNC: 10_000,
  // The server only acks after durably storing the update, and its internal
  // budget for a storage operation is 4.5s — so a busy-but-healthy server can
  // legitimately ack late. Waiting 5s keeps "server is busy" from being
  // misread as "update was lost".
  ACK: 5_000,
  SNAPSHOT: 10_000,
  REQUEST_UPDATES_SINCE: 10_000,
} as const;

export function mapToSyncStatus(
  status: WebsocketConnectionState
): SyncSourceStatus {
  switch (status) {
    case WebsocketConnectionState.Connecting:
      return SyncSourceStatus.Connecting;
    case WebsocketConnectionState.Open:
      return SyncSourceStatus.Connected;
    case WebsocketConnectionState.Closed:
    case WebsocketConnectionState.Closing:
    case WebsocketConnectionState.Reconnecting:
      return SyncSourceStatus.Disconnected;
  }
}

function syncEventForMessage(message: FromRemote): SyncSourceEvent | null {
  if (message.isRemoteUpdate()) {
    return { type: 'update', update: message.value.update };
  } else if (message.isRemoteAwareness()) {
    return { type: 'awareness', awareness: message.value.awareness };
  } else if (message.isRemoteSnapshot()) {
    return { type: 'incremental_snapshot', snapshot: message.value.snapshot };
  }
  return null;
}

/** A pending request: resolves with the first {@link FromRemote} that matches. */
interface MessageWaiter {
  match: (message: FromRemote) => boolean;
  resolve: (message: FromRemote) => void;
}

export interface SyncServiceSourceOptions {
  /** ID generator for update messages; overridable so tests can match acks. */
  newId?: () => string;
  /**
   * Connection status accessor. Defaults to a plain read of the socket state;
   * the browser injects a reactive Solid signal so UI tracks status changes.
   */
  status?: LiveSyncSource['status'];
}

/**
 * Transport-agnostic sync-service source.
 */
export class SyncServiceSource implements LiveSyncSource {
  public readonly documentId: string;

  private readonly ws: SyncSocket;
  private readonly newId: () => string;
  private readonly listeners = new Set<(event: SyncSourceEvent) => void>();
  /** Events that arrive before any listener attaches; flushed on `listen()`. */
  private readonly buffered: SyncSourceEvent[] = [];
  /** Pending request/response waiters, matched against each incoming message. */
  private readonly waiters = new Set<MessageWaiter>();
  private initialSyncReceived = false;
  private readonly initialSyncPromise: ResultAsync<InitialSync, TimeoutError>;

  public constructor(
    ws: SyncSocket,
    documentId: string,
    options: SyncServiceSourceOptions = {}
  ) {
    this.ws = ws;
    this.documentId = documentId;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    if (options.status) this.status = options.status;

    logSyncService({
      documentId,
      level: 'debug',
      context: {},
      message: 'sync source: created, waiting for WS open',
    });

    // Register the initial-sync listener eagerly so it's in place before the
    // server's RemoteInitialSync message arrives (~50ms after WS opens).
    // `doInitialSync()` just returns the cached promise; if it's called late,
    // it still resolves because the listener captured the message.
    this.initialSyncPromise = this.awaitInitialSync().map((message) => {
      this.initialSyncReceived = true;
      logSyncService({
        documentId,
        level: 'debug',
        context: {},
        message: 'sync source: initial sync received',
      });
      // Start heartbeat only after initial sync completes successfully — this
      // prevents the heartbeat from closing the connection during slow syncs.
      this.ws.startHeartbeat();
      return message.value as InitialSync;
    });

    this.ws.addEventListener(WebsocketEvent.Message, this.onMessage);
    this.ws.addEventListener(WebsocketEvent.Reconnect, this.onReconnect);

    this.registerEnvironmentListeners();
  }

  /**
   * When the browser regains connectivity or the tab becomes visible again,
   * kick the connection immediately instead of waiting out the current backoff
   * timer. No-ops in non-DOM environments (e.g. the worker).
   */
  private registerEnvironmentListeners(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  public doInitialSync = (): ResultAsync<InitialSync, TimeoutError> =>
    this.initialSyncPromise;

  public listen: LiveSyncSource['listen'] = (listener) => {
    this.listeners.add(listener);
    // Flush anything that arrived before the first listener attached.
    if (this.buffered.length > 0) {
      const pending = this.buffered.splice(0);
      for (const event of pending) listener(event);
    }
    return () => this.listeners.delete(listener);
  };

  public status: LiveSyncSource['status'] = () =>
    mapToSyncStatus(this.ws.connectionState);

  public pushUpdate = async (updates: RawUpdate[]): Promise<boolean> => {
    if (!this.initialSyncReceived) return false;
    if (updates.length === 0) return true;

    const id = this.newId();
    // Attach the ack listener before sending so an ack that races back early
    // can't be missed.
    const acked = this.awaitMessage(
      (message) => message.isRemoteUpdateAck() && message.value.id === id,
      TIMEOUTS.ACK
    ).then(
      () => true,
      () => false
    );

    this.ws.send(FromPeer.fromPeerUpdate({ updates, id }));
    return acked;
  };

  public pushAwareness = (awareness: RawUpdate): void => {
    // Awareness is ephemeral (cursor positions with a short server-side TTL),
    // so never let it sit in the send buffer
    if (this.ws.connectionState !== WebsocketConnectionState.Open) return;
    this.ws.send(FromPeer.fromPeerAwareness({ awareness }));
  };

  public registerPeerId = (peerId: bigint): void => {
    this.ws.send(FromPeer.fromPeerRegisterId({ peerid: peerId }));
  };

  public requestSnapshot = (): ResultAsync<RawUpdate, TimeoutError> => {
    this.ws.send(FromPeer.fromPeerRequestSnapshot({}));
    return ResultAsync.fromPromise(
      this.awaitMessage(
        (message) => message.isRemoteSnapshot(),
        TIMEOUTS.SNAPSHOT
      ),
      (error) => error as TimeoutError
    ).map((message) => (message.value as RemoteSnapshot).snapshot);
  };

  public requestUpdatesSince = (
    vv: VersionVector
  ): ResultAsync<RawUpdate, TimeoutError> => {
    const encodedVv = vv.encode();
    this.ws.send(FromPeer.fromPeerRequestSince({ vv: encodedVv }));
    return ResultAsync.fromPromise(
      this.awaitMessage(
        (message) =>
          message.isRemoteUpdateSince() &&
          arrayEquals(message.value.vv, encodedVv),
        TIMEOUTS.REQUEST_UPDATES_SINCE
      ),
      (error) => error as TimeoutError
    ).map((message) => (message.value as RemoteUpdateSince).update);
  };

  public reconnect = (): void => {
    // Only force a new connection when the socket is actually down. Tearing
    // down an OPEN socket caused reconnect storms, and tearing down a
    // CONNECTING one aborts an attempt that may be about to succeed. Liveness
    // of open sockets is owned by the heartbeat.
    this.ws.reconnectIfDisconnected();
  };

  public cleanup = (): void => {
    logSyncService({
      documentId: this.documentId,
      level: 'debug',
      context: {},
      message: 'sync source: cleanup called, closing WS',
    });
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.ws.removeEventListener(WebsocketEvent.Message, this.onMessage);
    this.ws.removeEventListener(WebsocketEvent.Reconnect, this.onReconnect);
    this.ws.close();
  };

  private emit(event: SyncSourceEvent) {
    if (this.listeners.size === 0) {
      this.buffered.push(event);
      return;
    }
    for (const listener of this.listeners) listener(event);
  }

  private awaitInitialSync(): ResultAsync<FromRemote, TimeoutError> {
    return ResultAsync.fromPromise(
      this.awaitMessage(
        (message) => message.isRemoteInitialSync(),
        TIMEOUTS.INITIAL_SYNC
      ),
      (error) => error as TimeoutError
    );
  }

  /**
   * Resolves with the next message matching `match`, or rejects with a
   * {@link TimeoutError} after `timeoutMs`. The waiter removes itself on both
   * paths, so a timed-out request leaves nothing behind.
   */
  private awaitMessage(
    match: (message: FromRemote) => boolean,
    timeoutMs: number
  ): Promise<FromRemote> {
    const { promise, resolve, reject } = Promise.withResolvers<FromRemote>();
    const waiter: MessageWaiter = {
      match,
      resolve: (message) => {
        remove();
        resolve(message);
      },
    };
    const timer = setTimeout(() => {
      remove();
      reject(SyncError.timeout(timeoutMs));
    }, timeoutMs);
    const remove = () => {
      clearTimeout(timer);
      this.waiters.delete(waiter);
    };
    this.waiters.add(waiter);
    return promise;
  }

  private onMessage: WebsocketEventListener<
    WebsocketEvent.Message,
    IFromPeer,
    FromRemote
  > = (_ws, event) => {
    const message = event.data;
    const syncEvent = syncEventForMessage(message);
    if (syncEvent) this.emit(syncEvent);
    // Resolve every pending request whose predicate matches this message.
    for (const waiter of [...this.waiters]) {
      if (waiter.match(message)) waiter.resolve(message);
    }
  };

  private onReconnect: WebsocketEventListener<
    WebsocketEvent.Reconnect,
    IFromPeer,
    FromRemote
  > = () => {
    logSyncService({
      documentId: this.documentId,
      level: 'debug',
      context: {},
      message: 'sync source: WS reconnected, waiting for initial sync',
    });
    // Always restart heartbeat after reconnect, regardless of sync
    // success/failure, so the connection stays monitored even if sync fails.
    this.ws.startHeartbeat();

    void this.awaitInitialSync().match(
      (message) => {
        const sync = message.value as InitialSync;
        logSyncService({
          documentId: this.documentId,
          level: 'debug',
          context: {},
          message:
            'sync source: reconnect initial sync received, emitting reconnect event',
        });
        this.emit({
          type: 'reconnect',
          snapshot: sync.snapshot,
          awareness: sync.awareness,
        });
      },
      (error) => {
        logSyncService({
          documentId: this.documentId,
          level: 'warn',
          context: { misc: { error } },
          message: 'sync source: reconnect initial sync timed out',
        });
        // Heartbeat is already running, so the connection remains monitored
        // even though sync failed; it will eventually timeout and retry.
      }
    );
  };

  private onOnline = (): void => this.reconnect();

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.reconnect();
  };
}
