import { describe, expect, it } from 'vitest';
import { createFreshSearch } from './freshSort';

interface MockItem {
  id: string;
  name: string;
  type: 'item' | 'channel';
  viewedAt?: number;
  updatedAt?: number;
}

function createSearch(opts: { useViewedAt?: boolean; channelBoost?: number }) {
  return createFreshSearch<MockItem>(
    {
      useViewedAt: opts.useViewedAt,
      channelBoost: opts.channelBoost,
      timeWeight: 0.9,
      fuzzyWeight: 0.1,
    },
    (item) => item.name
  );
}

describe('freshSort ordering', () => {
  it('orders by viewedAt - most recent first', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Meeting Notes', type: 'item', viewedAt: now - 3600000 }, // 1hr ago
      { id: '2', name: 'Project Plan', type: 'item', viewedAt: now - 60000 }, // 1min ago
      { id: '3', name: 'Old Draft', type: 'item', viewedAt: now - 86400000 }, // 1day ago
    ];

    const search = createSearch({ useViewedAt: true });
    const results = search(items, '');

    expect(results.map((r) => r.item.id)).toEqual(['2', '1', '3']);
  });

  it('boosts channels above documents when searching', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Design Doc', type: 'item', viewedAt: now - 1000 },
      {
        id: '2',
        name: 'Design Channel',
        type: 'channel',
        viewedAt: now - 5000,
      },
    ];

    const search = createSearch({ useViewedAt: true, channelBoost: 2.0 });
    const results = search(items, 'Design');

    expect(results[0].item.type).toBe('channel');
  });

  it('mixes documents and channels by recency without boost', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Doc A', type: 'item', viewedAt: now - 3600000 }, // 1hr ago
      { id: '2', name: 'Channel B', type: 'channel', viewedAt: now - 60000 }, // 1min ago
      { id: '3', name: 'Doc C', type: 'item', viewedAt: now - 86400000 }, // 1day ago
    ];

    const search = createSearch({ useViewedAt: true, channelBoost: 1.0 });
    const results = search(items, '');

    expect(results.map((r) => r.item.id)).toEqual(['2', '1', '3']);
  });
});
