import {
  normalizedCacheExchange,
  normalizedCacheResultMetadata,
} from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { createClient, createRequest, type Exchange } from '@urql/core';
import { expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import { channelListWitnessExchange } from './channel-list-witnesses';
import {
  SoupChannelListCacheWriteDocument,
  SoupUpdatesDocument,
} from './graphql/generated/graphql';

it('keeps the transport document and adds bounded display edges to the same cache write', async () => {
  const createdAt = '2025-01-01T00:00:00Z';
  const threadedMentions = Array.from({ length: 11 }, (_, n) => ({
    id: `mention-${n}`,
    eventType: 'channel_mention',
    state: 'UNSEEN',
    createdAt,
    metadata: {
      __typename: 'GraphqlChannelMentionMetadata',
      channelMentionThreadId: 'thread',
    },
  }));
  const message = {
    id: 'root',
    eventType: 'channel_message_send',
    state: 'UNSEEN',
    createdAt,
    metadata: { __typename: 'GraphqlChannelMessageSendMetadata' },
  };
  const writeQuery = vi.fn<CacheHost['writeQuery']>().mockResolvedValue({
    revision: INITIAL_CACHE_REVISION,
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
  });
  const host = {
    writeQuery,
    claimNextMutation: async () => undefined,
    onMutationSettled: () => () => {},
    onOpsAffected: () => () => {},
    onCacheGenerationChanged: () => () => {},
    teardown: async () => {},
  } satisfies Partial<CacheHost>;
  const lifetime = new AbortController();
  const notifications = [...threadedMentions, message];
  const transport: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'subscription'),
      map((operation) => {
        expect(operation.query).toBe(SoupUpdatesDocument);
        return {
          operation,
          data: {
            soupUpdates: [
              {
                __typename: 'SoupUpdated',
                item: { __typename: 'GraphqlSoupChannel', notifications },
              },
            ],
          },
          hasNext: false,
          stale: false,
        };
      })
    );
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      normalizedCacheExchange(host as unknown as CacheHost, {
        signal: lifetime.signal,
      }),
      channelListWitnessExchange,
      transport,
    ],
  });
  const result = await client.subscription(SoupUpdatesDocument, {}).toPromise();
  lifetime.abort();
  expect(result.operation.key).toBe(createRequest(SoupUpdatesDocument, {}).key);
  expect(result.operation.query).toBe(SoupChannelListCacheWriteDocument);
  expect(result.data).toEqual({
    soupUpdates: [
      {
        __typename: 'SoupUpdated',
        item: {
          __typename: 'GraphqlSoupChannel',
          notifications,
          unreadNotifications: [{ id: 'root', state: 'UNSEEN', createdAt }],
          unreadMentions: threadedMentions
            .slice(0, 10)
            .map(({ id, state }) => ({ id, state })),
        },
      },
    ],
  });
  expect(writeQuery).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationName: 'SoupChannelListCacheWrite',
      data: result.data,
    })
  );
  expect(normalizedCacheResultMetadata(result)).toMatchObject({
    source: 'live-network',
    cacheEffectsApplied: true,
  });
});
