import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
} from '@service-storage/crm-access-authority';
import { expect, it, vi } from 'vitest';
import { crmProtectedQueryKey } from './crm-cache-scope';
import type { PersistedQueryEntry } from './persistence/per-query-idb';

const fixture = vi.hoisted(() => ({
  entries: new Map<string, PersistedQueryEntry>(),
}));
vi.mock('./soup/normalized-cache/normalizer', () => ({
  initSoupNormalizer: () => {},
}));
vi.mock('./persistence-scopes', () => ({
  createQueryPersistenceScopes: () => [
    {
      buster: 'test',
      shouldPersist: (key: readonly unknown[]) =>
        key[0] === 'email' || key[0] === 'soup',
      store: {
        get: async (hash: string) => fixture.entries.get(hash),
        set: (entry: PersistedQueryEntry) =>
          fixture.entries.set(entry.queryHash, entry),
        remove: (hash: string) => fixture.entries.delete(hash),
        flush: async () => {},
        clear: async () => fixture.entries.clear(),
        prune: async (keep: (entry: PersistedQueryEntry) => boolean) => {
          for (const [hash, entry] of fixture.entries)
            if (!keep(entry)) fixture.entries.delete(hash);
        },
      },
    },
  ],
}));

import { queryClient, queryPersistence } from './client';

it('persists mail before the first proof and retires it only on proven denial', async () => {
  const team = '00000000-0000-4000-8000-000000000001';
  const fetchProof = vi.fn(async (): Promise<string> => {
    throw new TypeError('offline');
  });
  configureCrmAccessAuthority({
    fetchProof,
    retire: async (scope) => {
      if (scope) await queryPersistence.retire(crmProtectedQueryKey);
    },
  });
  crmAccessAuthority.setSession('viewer');
  const keys = [
    ['email', 'threadMessages', 'messages', 'owned-thread'],
    ['email', 'threadMessages', 'messages', 'crm-shared-thread'],
    ['soup', 'astItems', { filters: {} }],
  ];
  for (const queryKey of keys) {
    if (queryKey === keys[1]) {
      expect(fetchProof).not.toHaveBeenCalled();
      fetchProof.mockResolvedValue(`${team}:allowed`);
    }
    const queryHash = JSON.stringify(queryKey);
    fixture.entries.set(queryHash, {
      queryHash,
      queryKey,
      data: { body: 'offline snapshot' },
      dataUpdatedAt: Date.now(),
      persistedAt: Date.now(),
      buster: 'test',
    });
    await queryPersistence.restoreQuery(queryKey);
    expect(queryClient.getQueryData(queryKey)).toEqual({
      body: 'offline snapshot',
    });
    queryClient.setQueryData(queryKey, { body: 'new response' });
    expect(fixture.entries.get(queryHash)?.data).toEqual({
      body: 'new response',
    });
  }
  fetchProof.mockResolvedValue(`${team}:denied`);
  await crmAccessAuthority.refresh();
  for (const queryKey of keys) {
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(fixture.entries.has(JSON.stringify(queryKey))).toBe(false);
    // A late flush from another tab cannot rehydrate a denied snapshot.
    fixture.entries.set(JSON.stringify(queryKey), {
      queryHash: JSON.stringify(queryKey),
      queryKey,
      data: { body: 'late old response' },
      dataUpdatedAt: Date.now(),
      persistedAt: Date.now(),
      buster: 'test',
    });
    await queryPersistence.restoreQuery(queryKey);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  }
  queryPersistence.dispose();
  queryClient.clear();
});
