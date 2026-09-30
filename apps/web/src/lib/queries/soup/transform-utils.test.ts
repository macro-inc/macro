import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from './transform-utils';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));

describe('email soup entities', () => {
  it.each([true, false])(
    'preserves server Signal membership (%s) for Home activity',
    (isSignal) => {
      const item = {
        tag: 'emailThread',
        frecency_score: 0,
        is_favorited: false,
        data: {
          id: 'email',
          ownerId: 'owner',
          properties: [],
          attachments: [],
          labels: [],
          participants: [],
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
          sortTs: '2026-09-01T00:00:00Z',
          inboxVisible: true,
          isDraft: false,
          isRead: false,
          isImportant: !isSignal,
          isSignal,
        },
      } satisfies SoupApiItem;
      expect(mapApiSoupItemToEntity(item)).toMatchObject({
        type: 'email',
        isSignal,
        isImportant: !isSignal,
      });
    }
  );
});

describe('initiative soup entities', () => {
  it('keeps projects separate from folders and backing description documents', () => {
    const item = {
      tag: 'initiative',
      frecency_score: 0,
      is_favorited: false,
      data: {
        id: 'initiative',
        name: 'Launch',
        ownerId: 'owner',
        descriptionDocumentId: 'description',
        properties: [],
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
      },
    } satisfies SoupApiItem;
    expect(isDisplayableSoupItem(item)).toBe(true);
    expect(mapApiSoupItemToEntity(item)).toMatchObject({
      type: 'initiative',
      id: 'initiative',
      name: 'Launch',
      descriptionDocumentId: 'description',
      properties: [],
    });
  });
});

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
        isFavorited: false,
      });
    }
  );
});

describe('document soup entities', () => {
  it('excludes backing descriptions from lists while keeping direct document materialization', () => {
    const document = (
      id: string,
      subType: Extract<SoupApiItem, { tag: 'document' }>['data']['subType']
    ): Extract<SoupApiItem, { tag: 'document' }> => ({
      tag: 'document',
      frecency_score: 0,
      is_favorited: false,
      data: {
        id,
        name: 'Same title',
        ownerId: 'macro|owner@example.com',
        fileType: 'md',
        subType,
        documentVersionId: 1,
        properties: [],
        createdAt: '2026-09-11T00:00:00Z',
        updatedAt: '2026-09-11T00:00:00Z',
      },
    });
    const description = document('description', {
      type: 'initiative_description',
    });
    const folder: SoupApiItem = {
      tag: 'project',
      frecency_score: 0,
      is_favorited: false,
      data: {
        id: 'folder',
        name: 'Same title',
        ownerId: 'macro|owner@example.com',
        properties: [],
        createdAt: '2026-09-11T00:00:00Z',
        updatedAt: '2026-09-11T00:00:00Z',
      },
    };
    const items = [
      description,
      document('note', null),
      document('task', { type: 'task', is_completed: false }),
      folder,
    ];
    expect(
      items.filter(isDisplayableSoupItem).map((item) => item.data.id)
    ).toEqual(['note', 'task', 'folder']);
    expect(mapApiSoupItemToEntity(description)).toMatchObject({
      id: 'description',
      type: 'document',
    });
  });

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
