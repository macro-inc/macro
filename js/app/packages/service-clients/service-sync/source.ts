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
  BebopSerializer,
  ConstantBackoff,
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
import { okAsync, type Result, ResultAsync } from 'neverthrow';
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

  return new WebsocketBuilder(getUrl)
    .withSerializer(new BebopSerializer(FromPeer, FromRemote))
    .withBackoff(new ConstantBackoff(500))
    .withMaxRetries(20)
    .withHeartbeat({
      interval: 10_000,
      timeout: 5_000,
      pingMessage: 'ping',
      pongMessage: 'pong',
      maxMissedHeartbeats: 2,
      autoStart: false, // Start heartbeat manually after initial sync completes
    })
    .build();
}

const TIMEOUTS = {
  INITIAL_SYNC: 10_000,
  ACK: 3_000,
  SNAPSHOT: 10_000,
  REQUEST_UPDATES_SINCE: 10_000,
} as const;

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

  const pushUpdate = (
    update: RawUpdate
  ): ResultAsync<void, MissingAckError> => {
    // no point in sending messages, since we will do our catch-up sync once the
    // initial sync comes in
    if (!initialSyncReceived) {
      return okAsync(undefined);
    }

    const message = FromPeer.fromPeerUpdate({ update });
    ws.send(message);

    const ack = () => awaitingAckStore[rawUpdateToString(update)];

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
    ).map(() => {
      stopAwaitingAck(update);
    });
  };

  const pushAwareness = (awareness: RawUpdate) => {
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
    ws.reconnect();
  };

  const cleanup = () => {
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
