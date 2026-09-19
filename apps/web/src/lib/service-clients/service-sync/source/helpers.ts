import { resumeDocumentSpan } from '@block-md/observability';
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

/** Fetches a fresh sync-service connection token, or undefined on failure. */
type GetToken = () => Promise<string | undefined>;

/**
 * Sync websocket over any token source: uses the already-fetched token for the
 * initial connect, then calls `getToken` for a fresh token on every reconnect.
 *
 * `documentId` is the sync-service session key — a document id or a collab
 * surface id; the transport is identical.
 */
export function createTokenRefreshingSocket(
  documentId: string,
  initialToken: string,
  getToken: GetToken,
  traceparent?: () => string | undefined
): SyncWebsocket {
  const connectUrl = (token: string) => {
    const url = `${SYNC_SERVICE_WS_URL}/${documentId}/connect?token=${token}`;
    // Browsers can't set websocket headers, so the trace context rides a
    // query param; the sync service joins its spans to the active
    // transaction's trace.
    const trace = traceparent?.();
    return trace ? `${url}&traceparent=${encodeURIComponent(trace)}` : url;
  };
  let initialUrl: string | undefined = connectUrl(initialToken);
  let fallbackUrl = initialUrl;

  const getUrl: UrlResolver = async () => {
    if (initialUrl) {
      const url = initialUrl;
      initialUrl = undefined;
      return url;
    }

    const token = await getToken();
    if (!token) {
      console.error('failed to fetch sync connection token');
      return fallbackUrl;
    }

    const refreshedUrl = connectUrl(token);
    fallbackUrl = refreshedUrl;
    return refreshedUrl;
  };

  return createSyncSocket(getUrl);
}

/**
 * Browser sync websocket for a document: uses the already-fetched token for
 * the initial connect, then refetches a fresh permission token on every
 * reconnect.
 */
export function createSyncServiceSocket(
  documentId: string,
  initialToken: string
): SyncWebsocket {
  return createTokenRefreshingSocket(
    documentId,
    initialToken,
    async () => {
      const response =
        await storageServiceClient.permissionsTokens.createPermissionToken({
          document_id: documentId,
        });
      if (response.isErr()) {
        console.error('failed to fetch permission token', response);
        return undefined;
      }
      return response.value.token;
    },
    () => resumeDocumentSpan(documentId)?.traceparent()
  );
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

/**
 * Live sync source for a collab surface. Same transport as documents; only
 * the token endpoint differs (`/collab_surfaces/{id}/token`).
 */
export const createCollabSurfaceSource = (
  surfaceId: string,
  initialToken: string,
  getToken: GetToken
): {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
} => {
  const ws = createTokenRefreshingSocket(surfaceId, initialToken, getToken);
  const state = createWebsocketStateSignal(ws);
  const source = new SyncServiceSource(ws, surfaceId, {
    status: () => mapToSyncStatus(state()),
  });
  return { source, doInitialSync: source.doInitialSync };
};
