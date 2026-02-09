import { QueryClient } from '@tanstack/solid-query';
import { createIDBPersister } from './storage/idb';
import {
  createPersistenceKey,
  queryKeyHasPrefix,
  setupQueryPersistence,
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

setupQueryPersistence({
  queryClient,
  buster: import.meta.env.__APP_VERSION__ ?? 'dev',
  scopes: [
    {
      persister: createIDBPersister({
        key: createPersistenceKey('channels', 0),
      }),
      // 7 days in milliseconds
      maxAgeMs: 1000 * 60 * 60 * 24 * 7,
      shouldDehydrateQuery: (q) => queryKeyHasPrefix(q.queryKey, ['channel']),
    },
    {
      persister: createIDBPersister({
        key: createPersistenceKey('email-threads', 0),
      }),
      maxAgeMs: 1000 * 60 * 60 * 24 * 7,
      shouldDehydrateQuery: (q) =>
        queryKeyHasPrefix(q.queryKey, ['email', 'threadMessages']),
    },
  ],
});

export function useQueryClient() {
  return queryClient;
}
