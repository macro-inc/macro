import { partialMatchKey, type QueryKey } from '@tanstack/query-core';
import { channelKeys } from './channel/keys';
import { createPersistenceKey, type PersistScope } from './persistence';
import { createPerQueryIDBStore } from './persistence/per-query-idb';

const persistedChannelQueryPrefixes = [
  channelKeys.mentions._def,
  channelKeys.activity.queryKey,
  channelKeys.listChannels.queryKey,
] as const;

export function shouldPersistChannelQuery(queryKey: QueryKey): boolean {
  return persistedChannelQueryPrefixes.some((prefix) =>
    partialMatchKey(queryKey, prefix)
  );
}

export function createQueryPersistenceScopes(
  buster: string
): readonly PersistScope[] {
  return [
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('channels', 1),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: shouldPersistChannelQuery,
    },
    {
      store: createPerQueryIDBStore({
        dbName: createPersistenceKey('email-threads', 1),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: (queryKey) =>
        partialMatchKey(queryKey, ['email', 'threadMessages']),
    },
  ];
}
