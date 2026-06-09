import type { RawUpdate } from '@core/collab/shared';
import {
  type InitialSync,
  type MissingAckError,
  SyncError,
  type SyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
  type TimeoutError,
} from '@core/collab/source';
import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import { arrayEquals } from '@core/util/compareUtils';

import { storageServiceClient } from '@service-storage/client';
import { createEventBus } from '@solid-primitives/event-bus';
import { raceTimeout, until } from '@solid-primitives/promise';
import {
  ArrayQueue,
  BebopSerializer,
  ExponentialBackoff,
  type UrlResolver,
  untilMessage,
  WebsocketBuilder,
  WebsocketConnectionState,
} from '@websocket';
import {
  createReconnectEffect,
  createSocketEffect,
} from '@websocket/solid/socket-effect';
import { createWebsocketStateSignal } from '@websocket/solid/state-signal';
import { encodeFrontiers, type Frontiers } from 'loro-crdt';
import { errAsync, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createStore } from 'solid-js/store';
import {
  FromPeer,
  FromRemote,
  type RemoteSnapshot,
  type RemoteUpdateSince,
} from './generated/schema';

const SYNC_SERVICE_WS_URL = `${SYNC_SERVICE_HOSTS['ws']}/document`;

function mapToSyncStatus(status: WebsocketConnectionState): SyncSourceStatus {
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

function createSyncServiceSocket(documentId: string, initialToken: string) {
  const connectUrl = (token: string) =>
    `${SYNC_SERVICE_WS_URL}/${documentId}/connect?token=${token}`;
  let initialUrl: string | undefined = connectUrl(initialToken);
  let fallbackUrl = initialUrl;

  /**
   * Uses the already-fetched token for the initial connect, then refetches on reconnect.
   */
  const getUrl: UrlResolver = async () => {
    if (initialUrl) {
      const url = initialUrl;
      initialUrl = undefined;
      return url;
    }

    const response =
      await storageServiceClient.permissionsTokens.createPermissionToken({
        document_id: documentId,
      });

    if (response.isErr()) {
      console.error('failed to fetch permission token', response);
      return fallbackUrl;
    }

    const refreshedUrl = connectUrl(response.value.token);
    fallbackUrl = refreshedUrl;
    return refreshedUrl;
  };

  return (
    new WebsocketBuilder(getUrl)
      .withSerializer(new BebopSerializer(FromPeer, FromRemote))
      // Capped exponential backoff. The scheduler calls next() before the first
      // retry, so the delays are 250*2^1 = 500ms doubling to a 250*2^5 = 8s
      // cap; 20 retries ≈ 2 minutes of automatic attempts, after which
      // something is very wrong and we stop hammering. A given-up socket is
      // revived by 'online' / 'visibilitychange' signals or by the user editing
      // (see pushUpdate) — unlike before, exhausting the budget no longer
      // strands the socket permanently.
      .withBackoff(new ExponentialBackoff(250, 5))
      .withMaxRetries(20)
      // Queue messages sent while disconnected; they are flushed in order once
      // the connection is re-established, so edits made during a reconnect
      // aren't dropped. Unbounded on purpose: dropping the oldest updates would
      // leave dependency gaps the server can never fill, and CRDT updates are
      // tiny relative to a session's lifetime.
      .withBuffer(new ArrayQueue())
      .withHeartbeat({
        interval: 10_000,
        timeout: 5_000,
        pingMessage: 'ping',
        pongMessage: 'pong',
        maxMissedHeartbeats: 2,
        autoStart: false, // Start heartbeat manually after initial sync completes
      })
      .build()
  );
}

const TIMEOUTS = {
  INITIAL_SYNC: 10_000,
  // The server only acks after durably storing the update, and its internal
  // budget for a storage operation is 4.5s — so a busy-but-healthy server can
  // legitimately ack late. Waiting 5s keeps "server is busy" from being
  // misread as "update was lost".
  ACK: 5_000,
  SNAPSHOT: 10_000,
  REQUEST_UPDATES_SINCE: 10_000,
} as const;

/**
 * Times an un-acked update is re-sent before pushUpdate reports missing_ack.
 * The ACK timeout above covers the busy-server case; the single resend covers
 * a genuinely lost message (sent into a dying socket, or the server handler
 * aborted before acking). Updates are idempotent CRDT ops, so a duplicate
 * delivery is harmless.
 */
const ACK_RESENDS = 1;

type WithCleanup<T> = T & { cleanup: () => void };

export const createSyncServiceSource = (
  documentId: string,
  token: string
): {
  source: WithCleanup<SyncSource>;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
} => {
  const ws = createSyncServiceSocket(documentId, token);

  // Register the initial-sync listener eagerly so it's in place before the
  // server's RemoteInitialSync message arrives (~50ms after WS opens).
  // `doInitialSync()` just returns the cached promise; if it's called late,
  // it still resolves because the listener captured the message.
  let initialSyncReceived = false;
  const initialSyncPromise = ResultAsync.fromPromise(
    raceTimeout(
      untilMessage(ws, (message) => message.isRemoteInitialSync()),
      TIMEOUTS.INITIAL_SYNC,
      true
    ),
    () => SyncError.timeout(TIMEOUTS.INITIAL_SYNC)
  ).map((message) => {
    initialSyncReceived = true;
    // Start heartbeat only after initial sync completes successfully
    // This prevents the heartbeat from closing the connection during slow initial syncs
    ws.startHeartbeat();
    return message.value as InitialSync;
  });

  const doInitialSync = () => initialSyncPromise;

  const eventBus = createEventBus<SyncSourceEvent>();

  const status = createWebsocketStateSignal(ws);

  const [awaitingAckStore, setAwaitingAck] = createStore<Record<string, true>>(
    {}
  );

  const ackUpdate = (update: RawUpdate) => {
    setAwaitingAck((prev) => ({
      ...prev,
      [rawUpdateToString(update)]: true,
    }));
  };

  const stopAwaitingAck = (update: RawUpdate) => {
    setAwaitingAck((prev) => {
      const newState = { ...prev };
      delete newState[rawUpdateToString(update)];
      return newState;
    });
  };

  const syncEventForMessage = (message: FromRemote): SyncSourceEvent | null => {
    if (message.isRemoteUpdate()) {
      return {
        type: 'update',
        update: message.value.update,
      };
    } else if (message.isRemoteAwareness()) {
      return {
        type: 'awareness',
        awareness: message.value.awareness,
      };
    } else if (message.isRemoteSnapshot()) {
      return {
        type: 'incremental_snapshot',
        snapshot: message.value.snapshot,
      };
    }

    return null;
  };

  createSocketEffect(ws, async (message) => {
    const syncEvent = syncEventForMessage(message);
    if (syncEvent) {
      eventBus.emit(syncEvent);
    }

    if (message.isRemoteUpdateAck()) {
      ackUpdate(message.value.update);
    }
  });

  createReconnectEffect(ws, async () => {
    // Always restart heartbeat after reconnect, regardless of sync success/failure.
    // This ensures the connection is monitored even if sync fails.
    // startHeartbeat() is safe to call - it will no-op if connection closed.
    ws.startHeartbeat();

    let reconnectSyncResult: Result<InitialSync, TimeoutError> =
      await ResultAsync.fromPromise(
        raceTimeout(
          untilMessage(ws, (message) => message.isRemoteInitialSync()),
          TIMEOUTS.INITIAL_SYNC,
          true
        ),
        () => SyncError.timeout(TIMEOUTS.INITIAL_SYNC)
      ).map((message) => message.value as InitialSync);

    if (reconnectSyncResult.isErr()) {
      console.error(
        'Failed to reconnect to sync service',
        reconnectSyncResult.error
      );
      // Heartbeat is already running from above, so connection remains monitored
      // even though sync failed. The connection will eventually timeout and retry.
      return;
    }

    eventBus.emit({
      type: 'reconnect',
      snapshot: reconnectSyncResult.value.snapshot,
      awareness: reconnectSyncResult.value.awareness,
    });
  });

  const requestSnapshot = (): ResultAsync<RawUpdate, TimeoutError> => {
    const message = FromPeer.fromPeerRequestSnapshot({});
    ws.send(message);

    return ResultAsync.fromPromise(
      raceTimeout(
        untilMessage(ws, (message) => message.isRemoteSnapshot()),
        TIMEOUTS.SNAPSHOT,
        true
      ),
      () => SyncError.timeout(TIMEOUTS.SNAPSHOT)
    ).map((message) => (message.value as RemoteSnapshot).snapshot);
  };

  const registerPeerId = (peerId: bigint) => {
    const message = FromPeer.fromPeerRegisterId({ peerid: peerId });
    ws.send(message);
  };

  /**
   * True once the automatic retry budget is used up (mirrors the scheduling
   * condition in the websocket's retry logic: a retry is only scheduled while
   * retries <= maxRetries). The counter resets on every successful open.
   */
  const retriesExhausted = () =>
    ws.maxRetries !== undefined && (ws.backoff?.retries ?? 0) > ws.maxRetries;

  const pushUpdate = (
    update: RawUpdate
  ): ResultAsync<void, MissingAckError> => {
    // no point in sending messages, since we will do our catch-up sync once the
    // initial sync comes in
    if (!initialSyncReceived) {
      return okAsync(undefined);
    }

    const message = FromPeer.fromPeerUpdate({ update });
    const ack = () => awaitingAckStore[rawUpdateToString(update)];

    const attempt = (
      resendsLeft: number
    ): ResultAsync<void, MissingAckError> => {
      const sent = ws.send(message);
      if (!sent) {
        // Not connected: the update sits in the websocket's send buffer and is
        // flushed (and acked) once the connection is re-established, so don't
        // report a missing ack while the transport is down.
        //
        // If automatic retries gave up (maxRetries exhausted, so no retry is
        // scheduled anymore), this edit is the revival signal. The exhausted
        // check means this never preempts a pending backoff timer, and
        // reconnectIfDisconnected() is additionally a no-op while a
        // connection is open or being established.
        if (retriesExhausted()) {
          ws.reconnectIfDisconnected();
        }
        return okAsync(undefined);
      }

      return ResultAsync.fromPromise(
        raceTimeout(
          until(ack),
          TIMEOUTS.ACK,
          /** make sure until throws **/
          true
        ),
        () =>
          ({
            type: 'missing_ack',
            update: update,
          }) as const
      )
        .map(() => {
          stopAwaitingAck(update);
        })
        .orElse((err) => {
          // Updates are idempotent CRDT ops, so re-sending is safe. Retry
          // before reporting missing_ack: a late ack (slow storage write on
          // the server) shouldn't tear anything down.
          if (resendsLeft > 0) {
            return attempt(resendsLeft - 1);
          }
          return errAsync(err);
        });
    };

    return attempt(ACK_RESENDS);
  };

  const pushAwareness = (awareness: RawUpdate) => {
    // Awareness is ephemeral (cursor positions with a short server-side TTL),
    // so never let it sit in the send buffer: replaying a backlog of stale
    // cursor moves after a reconnect would flood the room for no benefit.
    // Drop it unless the socket is open right now — the next local cursor
    // move re-publishes fresh state anyway.
    if (ws.underlyingWebsocket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const message = FromPeer.fromPeerAwareness({ awareness });
    ws.send(message);
  };

  const requestUpdatesSince = (
    frontiers: Frontiers
  ): ResultAsync<RawUpdate, TimeoutError> => {
    let encodedFrontiers = encodeFrontiers(frontiers);
    const message = FromPeer.fromPeerRequestSince({
      frontiers: encodedFrontiers,
    });
    ws.send(message);

    return ResultAsync.fromPromise(
      raceTimeout(
        untilMessage(ws, (message) => {
          return (
            message.isRemoteUpdateSince() &&
            arrayEquals(message.value.frontiers, encodedFrontiers)
          );
        }),
        TIMEOUTS.REQUEST_UPDATES_SINCE,
        true
      ),
      () => SyncError.timeout(TIMEOUTS.REQUEST_UPDATES_SINCE)
    ).map((message) => (message.value as RemoteUpdateSince).update);
  };

  const reconnect = () => {
    // Only force a new connection when the socket is actually down. Tearing
    // down an OPEN socket (e.g. on a missed ack) caused reconnect storms, and
    // tearing down a CONNECTING one aborts an attempt that may be about to
    // succeed. Liveness of open sockets is owned by the heartbeat.
    ws.reconnectIfDisconnected();
  };

  // When the browser regains connectivity or the tab becomes visible again,
  // kick the connection immediately instead of waiting out the current
  // backoff timer (which may also have been throttled in background tabs).
  const handleOnline = reconnect;
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      reconnect();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const cleanup = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    ws.close();
  };

  return {
    source: {
      documentId,
      listen: eventBus.listen,
      status: () => mapToSyncStatus(status()),
      pushUpdate,
      registerPeerId,
      pushAwareness,
      requestSnapshot,
      requestUpdatesSince,
      reconnect,
      cleanup,
    },
    doInitialSync,
  };
};

const rawUpdateToString = (update: RawUpdate) =>
  btoa(String.fromCharCode(...update));
