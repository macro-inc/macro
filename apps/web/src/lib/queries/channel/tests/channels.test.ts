import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { queryClient } from '@queries/client';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { storageServiceClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentQueryAccount } from '../../auth/account-scope';
import { authKeys } from '../../auth/keys';
import {
  cachedGraphqlChannelsQueryOptions,
  fetchAllChannels,
} from '../channels';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannels: vi.fn(),
  },
}));

describe('fetchAllChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
  });

  it('stops pagination when a response belongs to a previous account', async () => {
    const page =
      Promise.withResolvers<
        Awaited<ReturnType<typeof storageServiceClient.getChannels>>
      >();
    vi.mocked(storageServiceClient.getChannels).mockReturnValue(page.promise);
    const reading = fetchAllChannels();
    const rejected = expect(reading).rejects.toThrow('Query account changed');
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'other',
      authenticated: true,
    });
    page.resolve(ok({ items: [], next_cursor: 'more' }));
    await rejected;
    expect(storageServiceClient.getChannels).toHaveBeenCalledOnce();
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

  it('fetches every channel page and returns one complete list', async () => {
    const firstChannel = { id: 'channel-1' } as ApiChannelWithLatest;
    const secondChannel = { id: 'channel-2' } as ApiChannelWithLatest;
    vi.mocked(storageServiceClient.getChannels)
      .mockResolvedValueOnce(
        ok({
          items: [firstChannel],
          next_cursor: 'next-page',
        })
      )
      .mockResolvedValueOnce(
        ok({
          items: [secondChannel],
          next_cursor: null,
        })
      );
    const controller = new AbortController();

    await expect(fetchAllChannels(controller.signal)).resolves.toEqual([
      firstChannel,
      secondChannel,
    ]);
    expect(storageServiceClient.getChannels).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 100,
      signal: controller.signal,
    });
    expect(storageServiceClient.getChannels).toHaveBeenNthCalledWith(2, {
      cursor: 'next-page',
      limit: 100,
      signal: controller.signal,
    });
  });
});
