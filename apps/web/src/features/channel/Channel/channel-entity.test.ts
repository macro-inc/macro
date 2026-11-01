import type { ChannelEntity } from '@entity/types/entity';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { QueryClient } from '@tanstack/query-core';
import { type Client, cacheExchange, createClient } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  graphql: true,
  client: undefined as Client | undefined,
  rest: vi.fn<typeof import('@queries/soup/items').useSoupAstItemsQuery>(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.graphql }),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.rest,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  mapGraphqlSoupPage: (data: { entities: ChannelEntity[] }) => ({
    items: data.entities,
  }),
}));
vi.mock('@queries/soup/transform-utils', () => ({
  mapApiSoupItemToEntity: (entity: ChannelEntity) => entity,
}));

import { useChannelByIdQuery, useChannelEntity } from './channel-entity';

const CHANNEL: ChannelEntity = {
  id: 'channel-1',
  type: 'channel',
  name: 'Design',
  ownerId: 'owner',
  channelType: 'private',
};
const restResult: SoupAstItemsQuery = {
  isPending: false,
  isEnabled: true,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  hasNextPage: false,
  transport: 'rest',
  error: null,
  data: { entities: [CHANNEL], groups: undefined },
  fetchNextPage: async () => {},
  refetch: async () => {},
  resetToInitialPage: () => {},
  refresh: async () => {},
};
const disposals: (() => void)[] = [];
const requests = vi.fn();

beforeEach(() => {
  mocks.graphql = true;
  mocks.rest.mockReset();
  mocks.rest.mockReturnValue(restResult);
  requests.mockClear();
  mocks.client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [
      cacheExchange,
      () => (operations) =>
        pipe(
          operations,
          filter((operation) => operation.kind === 'query'),
          map((operation) => {
            requests(operation);
            return {
              operation,
              data: { entities: [CHANNEL] },
              stale: false,
              hasNext: false,
            };
          })
        ),
    ],
  });
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

describe('channel menu entity', () => {
  it('reuses a completed GraphQL activation without another network request', () => {
    createRoot((dispose) => {
      disposals.push(dispose);
      const opened = useChannelByIdQuery(
        () => CHANNEL.id,
        () => true
      );
      expect(opened.data?.entities).toEqual([CHANNEL]);
      expect(requests).toHaveBeenCalledTimes(1);

      const menu = useChannelEntity(() => CHANNEL.id);
      expect(menu()).toEqual(CHANNEL);
      expect(requests).toHaveBeenCalledTimes(1);

      // Opening a conversation again must still refresh its unread edge.
      const reopened = useChannelByIdQuery(
        () => CHANNEL.id,
        () => true
      );
      expect(reopened.data?.entities).toEqual([CHANNEL]);
      expect(requests).toHaveBeenCalledTimes(2);
    });
  });

  it('fetches a menu whose conversation is not cached', () => {
    createRoot((dispose) => {
      disposals.push(dispose);
      const menu = useChannelEntity(() => CHANNEL.id);
      expect(menu()).toEqual(CHANNEL);
      expect(requests).toHaveBeenCalledTimes(1);
    });
  });

  it('reuses the REST cache without making activation reads stale', async () => {
    mocks.graphql = false;
    createRoot((dispose) => {
      disposals.push(dispose);
      useChannelEntity(() => CHANNEL.id);
      useChannelByIdQuery(
        () => CHANNEL.id,
        () => true
      );
    });
    const client = new QueryClient();
    const queryKey = ['channel', CHANNEL.id];
    const queryFn = vi.fn(async () => [CHANNEL]);
    client.setQueryData(queryKey, [CHANNEL]);
    try {
      const [, menuOptions] = mocks.rest.mock.calls[0];
      await client.fetchQuery({
        queryKey,
        queryFn,
        staleTime: menuOptions?.().staleTime,
      });
      expect(queryFn).not.toHaveBeenCalled();

      const [, activationOptions] = mocks.rest.mock.calls[1];
      await client.fetchQuery({
        queryKey,
        queryFn,
        staleTime: activationOptions?.().staleTime,
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      client.clear();
    }
  });

  it('never offers the previous conversation while a new channel is pending', () => {
    mocks.graphql = false;
    const [pending, setPending] = createSignal(false);
    mocks.rest.mockReturnValue({
      ...restResult,
      get isPending() {
        return pending();
      },
      get data() {
        if (pending()) throw new Error('Pending data must not be read');
        return { entities: [CHANNEL], groups: undefined };
      },
    });
    createRoot((dispose) => {
      disposals.push(dispose);
      const [id, setId] = createSignal(CHANNEL.id);
      const menu = useChannelEntity(id);
      expect(menu()).toEqual(CHANNEL);
      setPending(true);
      expect(menu()).toEqual(CHANNEL);
      setId('channel-2');
      expect(menu()).toBeUndefined();
    });
  });
});
