import { QueryClient } from '@tanstack/solid-query';
import { createPersistenceKey, setupQueryPersistence } from './persistence';
import { createQueryPersistenceScopes } from './persistence-scopes';
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
  scopes: createQueryPersistenceScopes(buster),
});

// Subscribe to query cache events for automatic normalization of soup entities
initSoupNormalizer(queryClient);

export function useQueryClient() {
  return queryClient;
}
