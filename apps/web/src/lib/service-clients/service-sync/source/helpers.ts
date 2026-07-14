import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import type {
  InitialSync,
  LiveSyncSource,
  TimeoutError,
} from '@macro-inc/collaboration/collab/source';
import {
  createSyncSocket,
  type SyncWebsocket,
} from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import type { UrlResolver } from '@macro-inc/collaboration/websocket';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { storageServiceClient } from '@service-storage/client';
import type { ResultAsync } from 'neverthrow';

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
