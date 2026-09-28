import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import type { DocumentSyncAuthorization } from '@service-sync/source/authorization';
import type {
  DocumentCacheSession,
  OfflineDocumentContext,
  OfflineDocumentContextCache,
} from './offline-context-cache';

export type FreshSyncDocumentContext = OfflineDocumentContext & {
  token: string;
};
export type SyncDocumentOpenContext = OfflineDocumentContext & {
  fromCache: boolean;
  token?: string;
  authorization?: DocumentSyncAuthorization;
};

function assertSession(
  cache: OfflineDocumentContextCache,
  session: DocumentCacheSession
) {
  if (!cache.isCurrent(session)) {
    throw new ThrownResultError([
      { code: 'UNAUTHORIZED', message: 'Document session changed' },
    ]);
  }
}

function accessDenied(error: unknown): boolean {
  // A latched global refresh error can also appear as UNAUTHORIZED while
  // offline. Global session confirmation/logout handles that; do not evict
  // last-known document access for an unconfirmed session refresh failure.
  return ['FORBIDDEN', 'NOT_FOUND', 'INVALID'].some((code) =>
    thrownResultErrorHasCode(error, code)
  );
}

/** Cache-first open, with network authority required independently for synchronization. */
export function createSyncDocumentContextLoader(options: {
  cache: OfflineDocumentContextCache;
  loadRemote: (
    documentId: string,
    session?: DocumentCacheSession
  ) => Promise<FreshSyncDocumentContext>;
  hasLocalSnapshot: (documentId: string) => Promise<boolean>;
  onSessionChange: (listener: () => void) => () => void;
}) {
  const { cache } = options;

  async function persist(
    session: DocumentCacheSession,
    context: OfflineDocumentContext
  ) {
    assertSession(cache, session);
    try {
      await cache.write(session, context);
    } catch {
      console.error('Failed to persist offline document context');
    }
    assertSession(cache, session);
  }

  function authorization(
    documentId: string,
    session: DocumentCacheSession,
    opened: OfflineDocumentContext,
    initial?: FreshSyncDocumentContext
  ): DocumentSyncAuthorization {
    let first = initial;
    let freshAccess = initial?.userAccessLevel;
    let revoked = false;
    const listeners = new Set<() => void>();
    const isCurrent = () => !revoked && cache.isCurrent(session);
    const notify = () => {
      for (const listener of listeners) listener();
    };
    return {
      isCurrent,
      canWrite: () =>
        isCurrent() &&
        (freshAccess === 'owner' ||
          freshAccess === 'edit' ||
          (freshAccess === 'comment' && opened.userAccessLevel === 'comment')),
      onInvalidated(listener) {
        listeners.add(listener);
        const unsubscribe = options.onSessionChange(() => {
          if (!isCurrent()) notify();
        });
        if (!isCurrent()) listener();
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
      async getToken() {
        assertSession(cache, session);
        if (revoked) throw new Error('Document access was revoked');
        freshAccess = undefined;
        try {
          const initial = first;
          first = undefined;
          const response =
            initial ?? (await options.loadRemote(documentId, session));
          assertSession(cache, session);
          if (!initial) await persist(session, response);
          if (!response.token)
            throw new Error('Document authorization returned no token');
          freshAccess = response.userAccessLevel;
          return response.token;
        } catch (error) {
          if (accessDenied(error)) {
            revoked = true;
            notify();
            try {
              await cache.remove(session, documentId);
            } catch {
              console.error('Failed to remove denied document context');
            }
          }
          throw error;
        }
      },
    };
  }

  return {
    async load(documentId: string): Promise<SyncDocumentOpenContext> {
      const session = cache.capture();
      if (session) {
        const cached = await cache.read(session, documentId);
        assertSession(cache, session);
        if (cached && (await options.hasLocalSnapshot(documentId))) {
          assertSession(cache, session);
          return {
            ...cached,
            fromCache: true,
            authorization: authorization(documentId, session, cached),
          };
        }
        assertSession(cache, session);
      }
      const fresh = await options.loadRemote(documentId, session);
      if (!session) return { ...fresh, fromCache: false };
      await persist(session, fresh);
      return {
        syncService: true,
        documentMetadata: fresh.documentMetadata,
        userAccessLevel: fresh.userAccessLevel,
        fromCache: false,
        authorization: authorization(documentId, session, fresh, fresh),
      };
    },
  };
}
