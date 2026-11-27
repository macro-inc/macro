import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { queryClient } from '@queries/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentQueryAccount } from '../../auth/account-scope';
import { authKeys } from '../../auth/keys';
import { cachedGraphqlChannelsQueryOptions } from '../channels';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

describe('cachedGraphqlChannelsQueryOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
  });

  it('rejects cached channel materialization across a storage generation change', async () => {
    let generation = '00000000-0000-4000-8000-000000000001';
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const host = createNoopCacheHost();
    host.currentStorageGeneration = async () => generation;
    host.readQuery = async () => ({
      kind: 'hit',
      data: { user: { id: 'viewer' } },
    });
    host.search = async () => {
      entered.resolve();
      await finish.promise;
      return { documents: [], nextCursor: null };
    };
    const reading = queryClient.fetchQuery(
      cachedGraphqlChannelsQueryOptions(host, currentQueryAccount(), 0)
    );
    const rejected = expect(reading).rejects.toThrow('scope changed');
    await entered.promise;
    generation = '00000000-0000-4000-8000-000000000002';
    finish.resolve();
    await rejected;
  });
});
