/**
 * @vitest-environment jsdom
 */

import 'fake-indexeddb/auto';
import { getOrCreateCacheScope } from '@graphql-cache/scope';
import { expect, it } from 'vitest';
import { createPersistenceKey } from './persistence';
import {
  createPerQueryIDBStore,
  type PersistedQueryEntry,
} from './persistence/per-query-idb';
import { createQueryPersistenceScopes } from './persistence-scopes';

const entry = (queryHash: string): PersistedQueryEntry => ({
  queryHash,
  queryKey: JSON.parse(queryHash),
  data: [],
  dataUpdatedAt: 1,
  persistedAt: 1,
  buster: 'test',
});

it('deletes the REST channel list and activity records, scoped or not, and keeps the directory', async () => {
  const store = createPerQueryIDBStore({
    dbName: createPersistenceKey(`channels-${getOrCreateCacheScope()}`, 1),
  });
  const retired = [
    '["channel","listChannels"]',
    '["channel","activity"]',
    '["channel","listChannels","user-1"]',
    '["channel","activity","user-1"]',
  ];
  const directory = '["channel","directory","user-1"]';
  for (const hash of [...retired, directory]) {
    store.set(entry(hash));
  }
  await store.flush();

  const [channels] = createQueryPersistenceScopes('test');
  await channels.store.flush();

  for (const hash of retired) {
    expect(await store.get(hash)).toBeUndefined();
  }
  expect(await store.get(directory)).toEqual(entry(directory));
});
