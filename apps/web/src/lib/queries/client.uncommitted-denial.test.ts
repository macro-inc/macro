import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import type { PersistedQueryEntry } from './persistence/per-query-idb';

const fixture = vi.hoisted(() => ({
  entries: new Map<string, PersistedQueryEntry>(),
  proof: vi.fn(),
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
vi.mock('./auth/user-info', () => ({ fetchUserInfo: vi.fn() }));
vi.mock('@service-storage/client', () => ({ dssFetch: fixture.proof }));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'http://localhost/dss' },
}));

import { crmAccessAuthority } from '@service-storage/crm-access-authority';
import {
  installCrmCacheHost,
  setCrmAccessSession,
} from '@service-storage/crm-access-cache';
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
  fixture.proof.mockResolvedValue(ok({ team_id: team, allowed: true }));
  // The production glue: its retirement clears and prunes the real persistence.
  installCrmCacheHost({
    ...createNoopCacheHost(),
    disabled: false,
    authority: owner,
  });
  setCrmAccessSession('viewer');
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

  fixture.proof.mockResolvedValue(ok({ team_id: team, allowed: false }));
  await expect(crmAccessAuthority.refresh()).rejects.toThrow('disk failure');
  await cacheSessionGeneration.settled();
  // The owner never recorded the denial, so its snapshot still reads allowed.
  expect(crmAccessAuthority.snapshot()?.policy).toBe(`${team}:allowed`);
  expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  expect(fixture.entries.has(queryHash)).toBe(false);
  // A late flush from another tab cannot rehydrate the denied snapshot.
  fixture.entries.set(queryHash, entry);
  await queryPersistence.restoreQuery(queryKey);
  expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  crmAccessAuthority.setSession(undefined);
  installCrmCacheHost(undefined);
  queryPersistence.dispose();
  queryClient.clear();
});
