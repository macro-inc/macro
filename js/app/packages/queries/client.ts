import { QueryClient } from '@tanstack/solid-query';
import { createPerQueryIDBStore } from './persistence/per-query-idb';
import {
  createPersistenceKey,
  queryKeyHasPrefix,
  setupLazyQueryPersistence,
} from './persistence';

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
const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;

setupLazyQueryPersistence({
  queryClient,
  scopes: [
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('channels', 1),
      }),
      maxAgeMs: SEVEN_DAYS_MS,
      buster,
      shouldPersist: (key) => queryKeyHasPrefix(key, ['channel']),
    },
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('email-threads', 1),
      }),
      maxAgeMs: SEVEN_DAYS_MS,
      buster,
      shouldPersist: (key) =>
        queryKeyHasPrefix(key, ['email', 'threadMessages']),
    },
  ],
});

export function useQueryClient() {
  return queryClient;
}
