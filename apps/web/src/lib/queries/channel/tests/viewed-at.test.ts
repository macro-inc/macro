import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { QueryClient } from '@tanstack/solid-query';
import { expect, it, vi } from 'vitest';
import type { DirectoryChannel } from '../directory-core';
import { channelKeys } from '../keys';
import { stampCachedChannelView, stampMemoryChannelView } from '../viewed-at';
import { directoryChannel } from './directory-channel';
import { channelRecord, fakeChannelCache } from './directory-fixtures';

const VIEWER = 'macro|viewer@example.com';
const GENERATION = { storageGeneration: 'g1' } as unknown as Parameters<
  typeof stampCachedChannelView
>[3];

function cacheWith(viewedAt: string | null) {
  const cache = fakeChannelCache();
  cache.put(channelRecord('c1', { viewedAt }));
  const writeQuery = vi.fn<CacheHost['writeQuery']>(async () => ({
    revision: INITIAL_CACHE_REVISION,
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
  }));
  return { host: { ...cache.host, writeQuery }, writeQuery };
}

it('stamps a later view on the cached channel', async () => {
  const { host, writeQuery } = cacheWith('2026-11-20T10:00:00Z');

  const stamped = await stampCachedChannelView(
    host,
    'c1',
    '2026-11-20T11:00:00Z',
    GENERATION
  );

  expect(stamped).toBe(true);
  expect(writeQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      generation: GENERATION,
      operationName: 'ChannelViewedAtCacheWrite',
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupChannel',
              id: 'c1',
              viewedAt: '2026-11-20T11:00:00Z',
            },
          },
        ],
      },
    })
  );
});

it('stamps a first view', async () => {
  const { host, writeQuery } = cacheWith(null);
  await stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION);
  expect(writeQuery).toHaveBeenCalledOnce();
});

it('never moves a view back', async () => {
  const { host, writeQuery } = cacheWith('2026-11-20T12:00:00Z');
  await stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION);
  expect(writeQuery).not.toHaveBeenCalled();
});

it('leaves a channel the cache does not hold alone', async () => {
  const { host, writeQuery } = cacheWith(null);
  const stamped = await stampCachedChannelView(
    host,
    'unknown',
    '2026-11-20T11:00:00Z',
    GENERATION
  );
  expect(stamped).toBe(false);
  expect(writeQuery).not.toHaveBeenCalled();
});

it('stamps a later view on the in-memory directory only', () => {
  const client = new QueryClient();
  const key = channelKeys.directory(VIEWER).queryKey;
  client.setQueryData(key, [
    directoryChannel('c1', { viewedAt: '2026-11-20T10:00:00Z' }),
    directoryChannel('c2', { viewedAt: '2026-11-20T09:00:00Z' }),
  ]);

  stampMemoryChannelView(client, VIEWER, 'c1', '2026-11-20T11:00:00Z');
  stampMemoryChannelView(client, VIEWER, 'c2', '2026-11-20T08:00:00Z');

  expect(
    client
      .getQueryData<DirectoryChannel[]>(key)
      ?.map(({ viewedAt }) => viewedAt)
  ).toEqual(['2026-11-20T11:00:00Z', '2026-11-20T09:00:00Z']);
});
