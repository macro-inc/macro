import { QueryClient } from '@tanstack/solid-query';
import { createPerQueryIDBStore } from './persistence/per-query-idb';
import { partialMatchKey } from '@tanstack/query-core';
import { createPersistenceKey, setupQueryPersistence } from './persistence';
import type { ChannelMessagesData } from './channel/channel-messages';

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
      maxAgeMs: SEVEN_DAYS_MS,
      buster,
      shouldPersist: (key) => partialMatchKey(key, ['channel', 'withID']),
    },
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('channel-messages', 1),
      }),
      maxAgeMs: SEVEN_DAYS_MS,
      buster,
      shouldPersist: (key) => partialMatchKey(key, ['channel', 'messages']),
      transformData: (data) => {
        const d = data as ChannelMessagesData;
        return {
          pages: d.pages.slice(0, 1),
          pageParams: d.pageParams.slice(0, 1),
        };
      },
    },
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('email-threads', 1),
      }),
      maxAgeMs: SEVEN_DAYS_MS,
      buster,
      shouldPersist: (key) => partialMatchKey(key, ['email', 'threadMessages']),
    },
  ],
});

export function useQueryClient() {
  return queryClient;
}
