import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));

import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from './transform-utils';

describe('agent session entity mapping', () => {
  it('retains session identity, properties, timestamps and ranking', () => {
    const item = {
      tag: 'agentSession',
      frecency_score: 8,
      is_favorited: false,
      data: {
        id: 'session',
        name: 'Fix mentions',
        ownerId: 'macro|owner@example.com',
        botId: 'bot',
        threadId: 'thread',
        status: 'session/end',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        viewedAt: '2026-01-03',
        properties: [],
      },
    } satisfies SoupApiItem;
    expect(isDisplayableSoupItem(item)).toBe(true);
    expect(mapApiSoupItemToEntity(item)).toMatchObject({
      ...item.data,
      type: 'agent_session',
      frecencyScore: 8,
    });
    expect(mapApiSoupItemToEntity(item)).not.toHaveProperty('projectId');
  });
});
