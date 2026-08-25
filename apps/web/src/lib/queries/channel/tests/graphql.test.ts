import type {
  CacheHost,
  ReadRecordsByKeysArgs,
  SearchCacheArgs,
  SearchCachePage,
} from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { expect, it, vi } from 'vitest';
import { readCachedGraphqlChannels } from '../graphql';

function cacheHost(
  search: (args: SearchCacheArgs) => Promise<SearchCachePage>,
  readRecordsByKeys: (
    args: ReadRecordsByKeysArgs
  ) => Promise<Array<{ recordKey: string; record: unknown }>>
): Pick<CacheHost, 'search' | 'readRecordsByKeys'> {
  return {
    search,
    readRecordsByKeys: async (args) => ({
      revision: INITIAL_CACHE_REVISION,
      records: await readRecordsByKeys(args),
    }),
  };
}

it('reads recent channels and DMs from the cache projection', async () => {
  const search = vi.fn(
    async (): Promise<SearchCachePage> => ({
      documents: [
        {
          profile: 'quick-access-v1',
          recordKey: 'GraphqlSoupChannel:channel-1',
          bucket: 'channel',
          searchText: 'general',
          timestampMs: 2,
          sourceHash: 'channel-hash',
        },
        {
          profile: 'quick-access-v1',
          recordKey: 'GraphqlSoupChannel:dm-1',
          bucket: 'dm',
          searchText: 'direct message',
          timestampMs: 1,
          sourceHash: 'dm-hash',
        },
      ],
      nextCursor: null,
    })
  );
  const readRecordsByKeys = vi.fn(async (args: ReadRecordsByKeysArgs) =>
    args.keys.map((recordKey) => ({
      recordKey,
      record: {
        __typename: 'GraphqlSoupChannel',
        name: recordKey.endsWith('dm-1') ? null : 'General',
        channelType: recordKey.endsWith('dm-1') ? 'direct_message' : 'public',
        ownerId: 'owner-1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        viewedAt: '2025-01-03T00:00:00.000Z',
        interactedAt: null,
        participants: [{ userId: 'user-1' }, { userId: 'user-2' }],
      },
    }))
  );

  const result = await readCachedGraphqlChannels(
    cacheHost(search, readRecordsByKeys)
  );

  expect(search).toHaveBeenCalledWith({
    profile: 'quick-access-v1',
    buckets: ['channel', 'dm'],
    query: '',
    limit: 50,
  });
  expect(readRecordsByKeys).toHaveBeenCalledWith(
    expect.objectContaining({
      fragmentName: 'GraphqlChannelQuickAccessFields',
      keys: ['GraphqlSoupChannel:channel-1', 'GraphqlSoupChannel:dm-1'],
    })
  );
  expect(result).toEqual([
    {
      id: 'channel-1',
      name: 'General',
      ownerId: 'owner-1',
      channelType: 'public',
      participantIds: ['user-1', 'user-2'],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      viewedAt: '2025-01-03T00:00:00.000Z',
      interactedAt: undefined,
    },
    {
      id: 'dm-1',
      name: '',
      ownerId: 'owner-1',
      channelType: 'direct_message',
      participantIds: ['user-1', 'user-2'],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      viewedAt: '2025-01-03T00:00:00.000Z',
      interactedAt: undefined,
    },
  ]);
});
