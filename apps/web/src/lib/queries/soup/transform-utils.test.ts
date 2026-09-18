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

describe('document soup entities', () => {
  it.each([
    [
      { type: 'task', is_completed: true },
      { type: 'task', is_completed: true },
    ],
    [{ type: 'skill' }, { type: 'skill' }],
    [{ type: 'initiative_description' }, undefined],
  ] as const)(
    'maps the wire sub type %j to the app sub type %j',
    (subType, expected) => {
      const item = {
        tag: 'document',
        frecency_score: 0,
        is_favorited: false,
        data: {
          id: 'doc-sub-type',
          name: 'Plan',
          ownerId: 'macro|owner@example.com',
          fileType: 'md',
          subType,
          documentVersionId: 1,
          properties: [],
          createdAt: '2026-09-11T00:00:00Z',
          updatedAt: '2026-09-11T00:00:00Z',
        },
      } satisfies SoupApiItem;

      expect(mapApiSoupItemToEntity(item)).toMatchObject({
        type: 'document',
        id: item.data.id,
        subType: expected,
      });
    }
  );
});
