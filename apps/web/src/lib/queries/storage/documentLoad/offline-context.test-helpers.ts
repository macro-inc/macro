import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import { createPerQueryIDBStore } from '../../persistence/per-query-idb';
import {
  createOfflineDocumentContextCache,
  type DocumentCacheIdentity,
  type OfflineDocumentContext,
} from './offline-context-cache';
import { createSyncDocumentContextLoader } from './sync-document-context-loader';

export const documentContext: OfflineDocumentContext = {
  syncService: true,
  documentMetadata: {
    documentId: 'doc-1',
    documentName: 'Offline note',
    documentVersionId: 1,
    owner: 'another-owner',
    fileType: 'md',
  },
  userAccessLevel: 'edit',
};
export const freshContext = {
  ...documentContext,
  token: 'fresh-test-credential',
};

export function harness() {
  const dbName = `document-context-test-${crypto.randomUUID()}`;
  let identity: DocumentCacheIdentity | undefined = {
    userId: 'viewer-a',
    epoch: 'login-1',
  };
  const listeners = new Set<() => void>();
  const create = () => {
    const store = createPerQueryIDBStore({ dbName, debounceMs: 60_000 });
    const cache = createOfflineDocumentContextCache({
      store,
      identity: () => identity,
    });
    const loadRemote = vi.fn(async () => freshContext);
    const hasLocalSnapshot = vi.fn(async () => true);
    const loader = createSyncDocumentContextLoader({
      cache,
      loadRemote,
      hasLocalSnapshot,
      onSessionChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    return { store, cache, loader, loadRemote, hasLocalSnapshot };
  };
  return {
    ...create(),
    restart: create,
    identify(next: DocumentCacheIdentity | undefined) {
      identity = next;
      for (const listener of listeners) listener();
    },
  };
}
