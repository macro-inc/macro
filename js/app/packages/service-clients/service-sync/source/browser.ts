import type {
  InitialSync,
  LiveSyncSource,
  TimeoutError,
} from '@core/collab/source';
import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import { storageServiceClient } from '@service-storage/client';
import type { UrlResolver } from '@websocket';
import { createWebsocketStateSignal } from '@websocket/solid/state-signal';
import type { ResultAsync } from 'neverthrow';
import { createSyncSocket, type SyncWebsocket } from './socket';
import { mapToSyncStatus, SyncServiceSource } from './source';

const SYNC_SERVICE_WS_URL = `${SYNC_SERVICE_HOSTS['ws']}/document`;

/**
 * Browser sync websocket: uses the already-fetched token for the initial
 * connect, then refetches a fresh permission token on every reconnect.
 */
export function createSyncServiceSocket(
  documentId: string,
  initialToken: string
): SyncWebsocket {
  const connectUrl = (token: string) =>
    `${SYNC_SERVICE_WS_URL}/${documentId}/connect?token=${token}`;
  let initialUrl: string | undefined = connectUrl(initialToken);
  let fallbackUrl = initialUrl;

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

  return createSyncSocket(getUrl);
}

/**
 * Browser entry point: builds a token-refreshing sync websocket, wraps it in a
 * {@link SyncServiceSource}, and overlays a reactive Solid `status` signal so
 * connection-status UI updates as the socket state changes.
 */
export const createSyncServiceSource = (
  documentId: string,
  token: string
): {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
} => {
  const ws = createSyncServiceSocket(documentId, token);
  const state = createWebsocketStateSignal(ws);
  const source = new SyncServiceSource(ws, documentId, {
    status: () => mapToSyncStatus(state()),
  });
  return { source, doInitialSync: source.doInitialSync };
};
