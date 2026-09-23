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

async function loadRemote(
  documentId: string,
  session?: DocumentCacheSession
): Promise<FreshSyncDocumentContext> {
  const [bundle, initialLocation] = await Promise.all([
    session
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
      : throwOnErr(() => fetchDocumentLoadBundle(documentId)),
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
  return {
    syncService: true,
    ...(session ? authorizedContext(documentId, session, bundle) : bundle),
  };
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

/** Open cached native documents before network work; authorize synchronization separately. */
export async function fetchSyncDocumentOpenContext(documentId: string) {
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
  return loadResult(catchToResult(() => loader.load(documentId)));
}
