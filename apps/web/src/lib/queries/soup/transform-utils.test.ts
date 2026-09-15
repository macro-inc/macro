import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  mapApiSoupItemToEntity,
  mapChannelSearchResultItem,
  useSearchResponseItemMapper,
} from './transform-utils';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [] }),
}));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));

describe('chat soup entities', () => {
  it.each(['openai/gpt-5.6', 'anthropic/claude-sonnet-5', null, undefined])(
    'preserves an optional saved model (%s) from REST or mapped GraphQL data',
    (model) => {
      const item = {
        tag: 'chat',
        frecency_score: 0,
        is_favorited: false,
        data: {
          id: 'chat-model',
          name: 'Chat',
          model,
          ownerId: 'macro|owner@example.com',
          isPersistent: true,
          properties: [],
          createdAt: '2026-09-11T00:00:00Z',
          updatedAt: '2026-09-11T00:00:00Z',
        },
      } satisfies SoupApiItem;

      expect(mapApiSoupItemToEntity(item)).toMatchObject({
        type: 'chat',
        id: item.data.id,
        model,
      });
    }
  );
});

describe('channel search entities', () => {
  it('preserves the parent channel favorite state on message hits', () => {
    const [entity] = mapChannelSearchResultItem(
      {
        channel_id: 'channel-id',
        channel_type: 'public',
        owner_id: 'macro|owner@example.com',
        is_favorited: true,
        channel_message_search_results: [
          {
            message_id: 'message-id',
            thread_id: null,
            sender_id: 'macro|sender@example.com',
            created_at: '2026-09-14T00:00:00Z',
            updated_at: '2026-09-14T00:00:00Z',
            deleted_at: null,
            highlight: { content: ['A matching message'] },
            score: null,
          },
        ],
      },
      [{ id: 'channel-id', name: 'Channel' }]
    );

    expect(entity).toMatchObject({
      type: 'channel_message',
      channelId: 'channel-id',
      isFavorited: true,
    });
  });
});

describe('unified search entities', () => {
  it('preserves favorite state on non-channel results', () => {
    const [entity] = useSearchResponseItemMapper()(
      {
        type: 'company',
        id: 'company-id',
        is_favorited: true,
        teamId: 'team-id',
        name: 'Acme',
        nameHighlighted: null,
        description: null,
        hidden: false,
        createdAt: '2026-09-14T00:00:00Z',
        updatedAt: '2026-09-14T00:00:00Z',
        domains: [],
      },
      ''
    );

    expect(entity).toMatchObject({
      type: 'crm_company',
      id: 'company-id',
      isFavorited: true,
    });
  });
});
