import { describe, expect, it } from 'vitest';
import { createFreshSearch, type TimestampedItem } from './freshSort';

interface TestItem extends TimestampedItem {
  name: string;
  type?: string;
  viewedAt?: number;
  updatedAt?: number;
}

describe('createFreshSearch', () => {
  it('sorts by viewedAt when enabled', () => {
    const now = Date.now();
    const items: TestItem[] = [
      { name: 'Old', viewedAt: now - 60 * 60 * 1000 },
      { name: 'Recent', viewedAt: now - 5 * 60 * 1000 },
    ];

    const search = createFreshSearch<TestItem>(
      { useViewedAt: true, timeWeight: 0.9, fuzzyWeight: 0.1 },
      (item) => item.name
    );

    const results = search(items, '');
    expect(results[0].item.name).toBe('Recent');
  });

  it('boosts channels when channelBoost > 1', () => {
    const now = Date.now();
    const items: TestItem[] = [
      { name: 'Doc', type: 'item', updatedAt: now - 1000 },
      { name: 'Channel', type: 'channel', updatedAt: now - 5000 },
    ];

    const search = createFreshSearch<TestItem>(
      { channelBoost: 3.0 },
      (item) => item.name
    );

    const results = search(items, '');
    expect(results[0].item.name).toBe('Channel');
  });

  it('filters by search query', () => {
    const items: TestItem[] = [
      { name: 'Apple', updatedAt: Date.now() },
      { name: 'Banana', updatedAt: Date.now() },
    ];

    const search = createFreshSearch<TestItem>({}, (item) => item.name);
    const results = search(items, 'Banana');

    expect(results.length).toBe(1);
    expect(results[0].item.name).toBe('Banana');
  });
});
