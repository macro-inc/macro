import { LoadErrors, loadResult } from '@core/block';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  catchToResult,
  ThrownResultError,
  throwOnErr,
} from '@core/util/result';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
} from '@macro-inc/collaboration/collab/snapshot-store';
import { z } from 'zod';
import { prefetchUserInfo } from '../../auth/user-info';
import { queryClient } from '../../client';
import {
  fetchDocumentLocation,
  waitForDocumentSyncServiceReady,
} from '../document-location';
import { authorizedContext } from './authorized-context';
import {
  type DocumentLoadBundle,
  documentLoadQueryOptions,
  fetchDocumentLoadBundle,
} from './documentLoadBundle';
import { documentLoadKeys } from './keys';
import type { DocumentCacheSession } from './offline-context-cache';
import {
  documentSessionEpoch,
  offlineDocumentContextCache,
  onDocumentSessionChange,
} from './offline-context-runtime';
import {
  createSyncDocumentContextLoader,
  type FreshSyncDocumentContext,
} from './sync-document-context-loader';

const pendingLocation = z.object({
  type: z.literal('presignedUrl'),
  content: z.object({ state: z.literal('pending') }),
});
const readyLocation = z.object({
  type: z.literal('syncServiceContent'),
  content: z.object({ state: z.literal('ready') }),
});

function fetchBundle(documentId: string, session?: DocumentCacheSession) {
  return session
    ? queryClient.fetchQuery({
        ...documentLoadQueryOptions(documentId),
        queryKey: documentLoadKeys.authorizedBundle(
          session.userId,
          session.epoch,
          documentId
        ).queryKey,
        // Authorization must not borrow a token from an earlier connection
        // or an in-flight request belonging to a different signed-in user.
        staleTime: 0,
      })
    : throwOnErr(() => fetchDocumentLoadBundle(documentId));
}

function bindBundle(
  documentId: string,
  session: DocumentCacheSession | undefined,
  bundle: DocumentLoadBundle
): FreshSyncDocumentContext {
  return {
    syncService: true,
    ...(session ? authorizedContext(documentId, session, bundle) : bundle),
  };
}

async function loadRemote(
  documentId: string,
  session?: DocumentCacheSession
): Promise<FreshSyncDocumentContext> {
  const [bundle, initialLocation] = await Promise.all([
    fetchBundle(documentId, session),
    throwOnErr(() => fetchDocumentLocation({ documentId })),
  ]);
  let location: unknown = initialLocation;
  if (pendingLocation.safeParse(location).success) {
    location = await waitForDocumentSyncServiceReady({ documentId });
  }
  // Initialization/repair belongs to the backend. Never fabricate readiness
  // or preserve a presigned URL as an offline authorization credential.
  if (!readyLocation.safeParse(location).success) {
    throw new ThrownResultError([
      {
        code: 'INVALID',
        message: 'Document content is not available in sync-service',
      },
    ]);
  }
  return bindBundle(documentId, session, bundle);
}

const loader = createSyncDocumentContextLoader({
  cache: offlineDocumentContextCache,
  loadRemote,
  async hasLocalSnapshot(documentId) {
    // Metadata alone must never bootstrap an editable empty document when the
    // cached body was evicted or never finished persisting.
    const store = new IDBSnapshotStore<RawUpdate>(
      LORO_SNAPSHOT_DB_NAME,
      documentId
    );
    try {
      const snapshot = await store.load();
      return snapshot !== null && snapshot.byteLength > 0;
    } catch {
      return false;
    }
  },
  onSessionChange: onDocumentSessionChange,
});

// An uploaded file (DOCX) stays in document storage until its first editor
// seeds it into sync-service, so its location is never sync-service content
// and there is no local snapshot to open from offline. Synchronization still
// uses the same session-bound authorization.
const fileLoader = createSyncDocumentContextLoader({
  cache: offlineDocumentContextCache,
  loadRemote: async (documentId, session) =>
    bindBundle(documentId, session, await fetchBundle(documentId, session)),
  hasLocalSnapshot: async () => false,
  onSessionChange: onDocumentSessionChange,
});

async function openWith(opener: typeof loader, documentId: string) {
  if (isNativeMobilePlatform() && !offlineDocumentContextCache.capture()) {
    const epoch = documentSessionEpoch();
    await prefetchUserInfo();
    if (
      epoch !== documentSessionEpoch() ||
      !offlineDocumentContextCache.capture()
    ) {
      return LoadErrors.UNAUTHORIZED;
    }
  }
  return loadResult(catchToResult(() => opener.load(documentId)));
}

/** Open cached native documents before network work; authorize synchronization separately. */
export function fetchSyncDocumentOpenContext(documentId: string) {
  return openWith(loader, documentId);
}

/** Open a stored-file document (DOCX), which needs no sync-service content, with the same authorization. */
export function fetchFileDocumentOpenContext(documentId: string) {
  return openWith(fileLoader, documentId);
}
