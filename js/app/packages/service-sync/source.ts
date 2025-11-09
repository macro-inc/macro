import type { RawUpdate } from '@core/collab/shared';
import {
  type ConnectionFailedError,
  type InitialSync,
  type MissingAckError,
  SyncError,
  type SyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
  type TimeoutError,
} from '@core/collab/source';
import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import { bytesEqual } from '@core/util/bytesEqual';
import { isErr as isChaseError } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { createEventBus } from '@solid-primitives/event-bus';
import { raceTimeout, until } from '@solid-primitives/promise';
import {
  bebopPlugin,
  createReconnectEffect,
  createSocketEffect,
  createWSState,
  heartbeatPlugin,
  makeDurableSocket,
  untilMessage,
  WebSocketState,
} from '@websocket/index';
import { encodeFrontiers, type Frontiers } from 'loro-crdt';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { createStore } from 'solid-js/store';
import {
  FromPeer,
  FromRemote,
  type RemoteSnapshot,
  type RemoteUpdateSince,
} from './generated/schema';

const SYNC_SERVICE_WS_URL = `${SYNC_SERVICE_HOSTS['ws']}/document`;

function mapToSyncStatus(status: WebSocketState): SyncSourceStatus {
  switch (status) {
    case WebSocketState.Connecting:
      return SyncSourceStatus.Connecting;
    case WebSocketState.Open:
      return SyncSourceStatus.Connected;
    case WebSocketState.Closed:
    case WebSocketState.Closing:
      return SyncSourceStatus.Disconnected;
  }
}

function createSyncServiceSocket(documentId: string, token: string) {
  const URL = `${SYNC_SERVICE_WS_URL}/${documentId}/connect?token=${token}`;

  /**
   * Refetches the token if it is expired
   */
  const getUrl = async () => {
    const response =
      await storageServiceClient.permissionsTokens.createPermissionToken({
        document_id: documentId,
      });

    if (isChaseError(response)) {
      console.error('failed to fetch permission token', response);
      return URL;
    }

    let token = response[1].token;

    return `${SYNC_SERVICE_WS_URL}/${documentId}/connect?token=${token}`;
  };

  return makeDurableSocket(
    URL,
    {
      backoffStrategy: 'constant',
      delay: 500,
      reconnectUrlResolver: getUrl,
    },
    [
      heartbeatPlugin({
        interval: 1_000,
        wait: 1_000,
      }),
      bebopPlugin(FromPeer, FromRemote),
    ]
  );
}

const TIMEOUTS = {
  INITIAL_SYNC: 10_000,
  ACK: 3_000,
  SNAPSHOT: 10_000,
  REQUEST_UPDATES_SINCE: 10_000,
} as const;

type WithCleanup<T> = T & { cleanup: () => void };

export const createSyncServiceSource = async (
  documentId: string,
  token: string
): Promise<
  Result<
    {
      source: WithCleanup<SyncSource>;
      initialSync: InitialSync;
    },
    ConnectionFailedError | TimeoutError
  >
> => {
  const ws = createSyncServiceSocket(documentId, token);

  const initialSyncResult = await ResultAsync.fromPromise(
    raceTimeout(
      untilMessage(ws, (message) => message.isRemoteInitialSync()),
      TIMEOUTS.INITIAL_SYNC,
      true
    ),
    () => SyncError.timeout(TIMEOUTS.INITIAL_SYNC)
  );

  if (initialSyncResult.isErr()) {
    return err(initialSyncResult.error);
  }

  const initialSync = initialSyncResult.value;

  const eventBus = createEventBus<SyncSourceEvent>();

  const status = createWSState(ws);

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
            bytesEqual(message.value.frontiers, encodedFrontiers)
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

  return ok({
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
    initialSync: initialSync.value as InitialSync,
  });
};

const rawUpdateToString = (update: RawUpdate) =>
  btoa(String.fromCharCode(...update));
