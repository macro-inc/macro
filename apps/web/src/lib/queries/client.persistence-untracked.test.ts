import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
} from '@service-storage/crm-access-authority';
import { createMemo, createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';

vi.mock('./soup/normalized-cache/normalizer', () => ({
  initSoupNormalizer: () => {},
}));
vi.mock('./persistence-scopes', () => ({
  createQueryPersistenceScopes: () => [
    {
      buster: 'test',
      shouldPersist: () => true,
      store: {
        get: async () => undefined,
        set: () => {},
        remove: () => {},
        flush: async () => {},
        clear: async () => {},
        prune: async () => {},
      },
    },
  ],
}));

import { queryClient, queryPersistence } from './client';

it('does not subscribe a computation that writes a query to CRM access changes', async () => {
  const team = '00000000-0000-4000-8000-000000000001';
  configureCrmAccessAuthority({
    fetchProof: async () => `${team}:allowed`,
    retire: async () => {},
  });
  crmAccessAuthority.setSession('viewer');
  expect(crmAccessAuthority.state()).toBe('pending');
  let runs = 0;
  const dispose = createRoot((dispose) => {
    // The persistence policy is consulted inside this computation.
    createMemo(() => {
      runs += 1;
      queryClient.setQueryData(['channel', 'directory', 'viewer'], {
        rows: [],
      });
    });
    return dispose;
  });
  expect(runs).toBe(1);

  await crmAccessAuthority.refresh();
  expect(crmAccessAuthority.state()).toBe('allowed');
  expect(runs).toBe(1);

  dispose();
  crmAccessAuthority.setSession(undefined);
  queryPersistence.dispose();
  queryClient.clear();
});
