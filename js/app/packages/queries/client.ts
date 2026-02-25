import { QueryClient } from '@tanstack/solid-query';
import { createPerQueryIDBStore } from './persistence/per-query-idb';
import { partialMatchKey } from '@tanstack/query-core';
import { createPersistenceKey, setupQueryPersistence } from './persistence';
import { initSoupNormalizer } from './soup/cache';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const buster = import.meta.env.__APP_VERSION__ ?? 'dev';

// Clean up orphaned v0 databases from the old whole-cache persistence format
try {
  indexedDB.deleteDatabase(createPersistenceKey('channels', 0));
  indexedDB.deleteDatabase(createPersistenceKey('email-threads', 0));
} catch {}

setupQueryPersistence({
  queryClient,
  scopes: [
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('channels', 1),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: (key) => partialMatchKey(key, ['channel']),
    },
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('email-threads', 1),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: (key) => partialMatchKey(key, ['email', 'threadMessages']),
    },
  ],
});

// Subscribe to query cache events for automatic normalization of soup entities
initSoupNormalizer(queryClient);

export function useQueryClient() {
  return queryClient;
}
