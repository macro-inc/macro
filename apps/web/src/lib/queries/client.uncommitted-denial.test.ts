import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import {
  type CrmRetirementScope,
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
      shouldPersist: (key: readonly unknown[]) => key[0] === 'email',
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

it('retires and keeps out protected snapshots after a proven denial the owner could not commit', async () => {
  const team = '00000000-0000-4000-8000-000000000001';
  const authority: CacheAuthority = {
    identity: 'profile',
    account: 'viewer',
    generation: '00000000-0000-4000-8000-000000000002',
    policy: `${team}:allowed`,
    ready: true,
  };
  const owner: CacheAuthorityHost = {
    current: async () => authority,
    snapshot: () => authority,
    onChanged: () => () => {},
    transition: async (_expected, policy) => {
      if (policy.endsWith(':denied')) throw new Error('disk failure');
      return { authority, revision: '0', affectedOps: [], changed: false };
    },
  };
  const retired = Promise.withResolvers<void>();
  const retire = vi.fn(async (scope: CrmRetirementScope | undefined) => {
    if (!scope) return;
    await queryPersistence.retire(crmProtectedQueryKey);
    retired.resolve();
  });
  const fetchProof = vi.fn(async (): Promise<string> => `${team}:allowed`);
  configureCrmAccessAuthority({ fetchProof, retire });
  crmAccessAuthority.setHost(owner);
  crmAccessAuthority.setSession('viewer');
  await crmAccessAuthority.refresh();

  const queryKey = ['email', 'threadMessages', 'messages', 'crm-shared-thread'];
  const queryHash = JSON.stringify(queryKey);
  const entry: PersistedQueryEntry = {
    queryHash,
    queryKey,
    data: { body: 'offline snapshot' },
    dataUpdatedAt: Date.now(),
    persistedAt: Date.now(),
    buster: 'test',
  };
  fixture.entries.set(queryHash, entry);
  await queryPersistence.restoreQuery(queryKey);
  expect(queryClient.getQueryData(queryKey)).toEqual({
    body: 'offline snapshot',
  });

  fetchProof.mockResolvedValue(`${team}:denied`);
  await expect(crmAccessAuthority.refresh()).rejects.toThrow('disk failure');
  expect(retire).toHaveBeenCalledWith('permission', authority.generation);
  await retired.promise;
  // The owner never recorded the denial, so its snapshot still reads allowed.
  expect(crmAccessAuthority.snapshot()?.policy).toBe(`${team}:allowed`);
  expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  expect(fixture.entries.has(queryHash)).toBe(false);
  // A late flush from another tab cannot rehydrate the denied snapshot.
  fixture.entries.set(queryHash, entry);
  await queryPersistence.restoreQuery(queryKey);
  expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  queryPersistence.dispose();
  queryClient.clear();
});
