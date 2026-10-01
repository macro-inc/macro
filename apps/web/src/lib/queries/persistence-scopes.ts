import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { hasLoginCookie } from '@core/util/cookies';
import { getOrCreateCacheScope } from '@graphql-cache/scope';
import { partialMatchKey, type QueryKey } from '@tanstack/query-core';
import { authKeys } from './auth/keys';
import { hasCachedUserIdentity } from './auth/user-info-cache';
import { channelKeys } from './channel/keys';
import { createPersistenceKey, type PersistScope } from './persistence';
import { createPerQueryIDBStore } from './persistence/per-query-idb';
import { soupKeys } from './soup/keys';

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
  // A failed durable logout wipe can rotate this shared scope before relaunch.
  const accountScope = getOrCreateCacheScope();
  const scopedKey = (name: string) =>
    createPersistenceKey(`${name}-${accountScope}`, 1);
  return [
    {
      store: createPerQueryIDBStore({
        dbName: scopedKey('channels'),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: shouldPersistChannelQuery,
      shouldRestore: hasLoginCookie,
    },
    {
      store: createPerQueryIDBStore({
        dbName: scopedKey('email-threads'),
      }),
      maxAge: { value: 7, unit: 'd' },
      buster,
      shouldPersist: (queryKey) =>
        partialMatchKey(queryKey, ['email', 'threadMessages']),
      shouldRestore: hasLoginCookie,
    },
    ...(isNativeMobilePlatform()
      ? [
          {
            store: createPerQueryIDBStore({
              dbName: scopedKey('soup-list-queries'),
            }),
            maxAge: { value: 7, unit: 'd' },
            buster,
            shouldPersist: (queryKey: QueryKey) =>
              partialMatchKey(queryKey, soupKeys.astItems._def),
            shouldRestore: hasLoginCookie,
          } satisfies PersistScope,
          {
            store: createPerQueryIDBStore({
              dbName: scopedKey('user-info'),
            }),
            buster,
            shouldPersist: (queryKey: QueryKey) =>
              partialMatchKey(queryKey, authKeys.userInfo.queryKey),
            shouldRestore: hasLoginCookie,
            // Keep persisting logout to supersede the old identity, but never
            // hydrate that marker into a new login (which would clear its cookie).
            shouldRestoreData: hasCachedUserIdentity,
          } satisfies PersistScope,
        ]
      : []),
  ];
}
