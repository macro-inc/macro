import { ok } from 'neverthrow';
import { DEV } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  const queryClient = new QueryClient();
  return { queryClient, useQueryClient: () => queryClient };
});
vi.mock('@queries/soup/cache', () => ({
  hasSoupEntity: () => true,
  optimisticUpdateSoupItemViewedAt: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));
vi.mock('@service-storage/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-storage/client')>()),
  storageServiceClient: { upsertItemToUserHistory: mocks.upsert },
}));
vi.mock('@service-storage/graphql-soup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-storage/graphql-soup')>()),
  getGraphqlSoupCacheHost: () => undefined,
}));

import { queryClient } from '@queries/client';
import { historyKeys } from '@queries/history/keys';
import { trackOpen } from './track-open';
// Loaded up front so trackOpen's lazy import of it resolves at once. It is
// still awaited, so the open is still recorded with no Solid owner current.
import './trackBlockOpened';

type CreatedOwner = { fn?: unknown; owner: unknown };

const created: CreatedOwner[] = [];
const hooks = DEV?.hooks;

beforeEach(() => {
  mocks.upsert.mockResolvedValue(ok({ success: true }));
  if (hooks)
    hooks.afterCreateOwner = (owner) => {
      created.push(owner as CreatedOwner);
    };
});
afterEach(() => {
  if (hooks) hooks.afterCreateOwner = null;
  created.length = 0;
  queryClient.clear();
  vi.clearAllMocks();
});

// A computation created with no owner (such as a mutation hook's memo) is
// never disposed, and it keeps every view whose signals it reads alive.
it('records an open without creating a computation nothing disposes', async () => {
  expect(hooks).toBeDefined();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

  trackOpen('doc-1', 'md', () => true);

  await vi.waitFor(() =>
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({
      itemId: 'doc-1',
      itemType: 'document',
    })
  );
  await vi.waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: historyKeys.list.queryKey,
    })
  );
  const ownerless = created.filter(
    (owner) => owner.fn !== undefined && owner.owner === null
  );
  expect(ownerless).toHaveLength(0);
});
