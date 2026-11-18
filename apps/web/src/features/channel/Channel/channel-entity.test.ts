import type { ChannelEntity } from '@entity/types/entity';
import { type Client, cacheExchange, createClient } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  client: undefined as Client | undefined,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  mapGraphqlSoupPage: (data: {
    user: { soup: { items: ChannelEntity[] } };
  }) => ({
    items: data.user.soup.items,
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
const disposals: (() => void)[] = [];
const requests = vi.fn();

beforeEach(() => {
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
              data: { user: { soup: { items: [CHANNEL] } } },
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
});
