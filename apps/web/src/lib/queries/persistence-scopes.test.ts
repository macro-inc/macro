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

it('deletes channel records saved without an account and keeps scoped ones', async () => {
  const store = createPerQueryIDBStore({
    dbName: createPersistenceKey(`channels-${getOrCreateCacheScope()}`, 1),
  });
  const legacyList = '["channel","listChannels"]';
  const legacyActivity = '["channel","activity"]';
  const scopedList = '["channel","listChannels","user-1"]';
  for (const hash of [legacyList, legacyActivity, scopedList]) {
    store.set(entry(hash));
  }
  await store.flush();

  const [channels] = createQueryPersistenceScopes('test');
  await channels.store.flush();

  expect(await store.get(legacyList)).toBeUndefined();
  expect(await store.get(legacyActivity)).toBeUndefined();
  expect(await store.get(scopedList)).toEqual(entry(scopedList));
});
