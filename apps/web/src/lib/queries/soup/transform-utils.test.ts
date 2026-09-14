import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import { mapApiSoupItemToEntity } from './transform-utils';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
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
