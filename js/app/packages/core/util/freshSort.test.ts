import { describe, expect, it } from 'vitest';
import { createFreshSearch, freshSort, type TimestampedItem } from './freshSort';
import fuzzy from 'fuzzy';

interface TestItem extends TimestampedItem {
  name: string;
  type?: string;
  viewedAt?: number;
  updatedAt?: number;
}

describe('freshSort', () => {
  describe('viewedAt-based sorting', () => {
    it('should sort by viewedAt when useViewedAt is true with high time weight', () => {
      const now = Date.now();
      // Use larger time differences to make the sorting more pronounced
      const items: TestItem[] = [
        { name: 'Item A', viewedAt: now - 60 * 60 * 1000, updatedAt: now - 5 * 60 * 60 * 1000 }, // 1 hour ago
        { name: 'Item B', viewedAt: now - 5 * 60 * 1000, updatedAt: now - 10 * 60 * 60 * 1000 }, // 5 min ago (most recent)
        { name: 'Item C', viewedAt: now - 2 * 60 * 60 * 1000, updatedAt: now - 100 }, // 2 hours ago
      ];

      const filterResults = fuzzy.filter('Item', items, {
        extract: (item) => item.name,
      });

      // Use high time weight to make time the dominant factor
      const results = freshSort(filterResults, {
        useViewedAt: true,
        timeWeight: 0.9,
        fuzzyWeight: 0.1,
      });

      // Item B has most recent viewedAt, should be first
      expect(results[0].item.name).toBe('Item B');
      // Item A has second most recent viewedAt
      expect(results[1].item.name).toBe('Item A');
      // Item C has oldest viewedAt
      expect(results[2].item.name).toBe('Item C');
    });

    it('should fall back to updatedAt when viewedAt is not set', () => {
      const now = Date.now();
      // Use larger time differences
      const items: TestItem[] = [
        { name: 'Item A', updatedAt: now - 60 * 60 * 1000 }, // 1 hour ago
        { name: 'Item B', viewedAt: now - 30 * 60 * 1000 }, // 30 min ago
        { name: 'Item C', updatedAt: now - 5 * 60 * 1000 }, // 5 min ago (most recent)
      ];

      const filterResults = fuzzy.filter('Item', items, {
        extract: (item) => item.name,
      });

      // Use high time weight to make time the dominant factor
      const results = freshSort(filterResults, {
        useViewedAt: true,
        timeWeight: 0.9,
        fuzzyWeight: 0.1,
      });

      // Item C has most recent time (updatedAt since no viewedAt)
      expect(results[0].item.name).toBe('Item C');
      // Item B has viewedAt which is used
      expect(results[1].item.name).toBe('Item B');
    });

    it('should use updatedAt when useViewedAt is false', () => {
      const now = Date.now();
      // Use larger time differences
      const items: TestItem[] = [
        { name: 'Item A', viewedAt: now - 5 * 60 * 1000, updatedAt: now - 5 * 60 * 60 * 1000 }, // viewedAt: 5 min ago, updatedAt: 5 hours ago
        { name: 'Item B', viewedAt: now - 5 * 60 * 60 * 1000, updatedAt: now - 5 * 60 * 1000 }, // viewedAt: 5 hours ago, updatedAt: 5 min ago (most recent)
      ];

      const filterResults = fuzzy.filter('Item', items, {
        extract: (item) => item.name,
      });

      // Use high time weight to make time the dominant factor
      const results = freshSort(filterResults, {
        useViewedAt: false,
        timeWeight: 0.9,
        fuzzyWeight: 0.1,
      });

      // Item B has most recent updatedAt, should be first when useViewedAt is false
      expect(results[0].item.name).toBe('Item B');
      expect(results[1].item.name).toBe('Item A');
    });
  });

  describe('channel boost', () => {
    it('should boost channel items when channelBoost > 1.0', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { name: 'Document A', type: 'item', updatedAt: now - 1000 },
        { name: 'Channel A', type: 'channel', updatedAt: now - 2000 },
        { name: 'Document B', type: 'item', updatedAt: now - 1500 },
      ];

      const filterResults = fuzzy.filter('A', items, {
        extract: (item) => item.name,
      });

      const results = freshSort(filterResults, { channelBoost: 2.0 });

      // Channel A should be boosted to first position despite older timestamp
      expect(results[0].item.name).toBe('Channel A');
    });

    it('should not boost channels when channelBoost is 1.0', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { name: 'Document A', type: 'item', updatedAt: now - 1000 },
        { name: 'Channel A', type: 'channel', updatedAt: now - 2000 },
      ];

      const filterResults = fuzzy.filter('A', items, {
        extract: (item) => item.name,
      });

      const results = freshSort(filterResults, { channelBoost: 1.0 });

      // Document A should be first since it's more recent and no boost
      expect(results[0].item.name).toBe('Document A');
    });

    it('should boost DMs (which are also channels) when channelBoost is applied', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { name: 'Note A', type: 'item', updatedAt: now - 500 },
        { name: 'Channel A', type: 'channel', updatedAt: now - 3000 },
      ];

      const filterResults = fuzzy.filter('A', items, {
        extract: (item) => item.name,
      });

      // Use high enough boost to overcome the time difference
      const results = freshSort(filterResults, { channelBoost: 3.0 });

      // Channel item should be boosted
      expect(results[0].item.name).toBe('Channel A');
    });
  });

  describe('combined viewedAt and channelBoost', () => {
    it('should apply both viewedAt sorting and channel boost', () => {
      const now = Date.now();
      const items: TestItem[] = [
        {
          name: 'Recent Doc',
          type: 'item',
          viewedAt: now - 100,
          updatedAt: now - 5000,
        },
        {
          name: 'Old Channel',
          type: 'channel',
          viewedAt: now - 2000,
          updatedAt: now - 10000,
        },
        {
          name: 'Medium Doc',
          type: 'item',
          viewedAt: now - 500,
          updatedAt: now - 1000,
        },
      ];

      const filterResults = fuzzy.filter('', items, {
        extract: (item) => item.name,
      });

      const results = freshSort(filterResults, {
        useViewedAt: true,
        channelBoost: 1.5,
      });

      // Channel should be boosted despite older viewedAt
      expect(results[0].item.type).toBe('channel');
    });
  });
});

describe('createFreshSearch', () => {
  it('should create a search function with the given config', () => {
    const now = Date.now();
    const items: TestItem[] = [
      { name: 'Test Channel', type: 'channel', viewedAt: now - 1000 },
      { name: 'Test Document', type: 'item', viewedAt: now - 500 },
    ];

    const freshSearch = createFreshSearch<TestItem>(
      { useViewedAt: true, channelBoost: 1.5 },
      (item) => item.name
    );

    const results = freshSearch(items, 'Test');

    // Channel should be boosted
    expect(results[0].item.type).toBe('channel');
  });

  it('should handle empty query', () => {
    const items: TestItem[] = [
      { name: 'Item A', updatedAt: Date.now() - 1000 },
      { name: 'Item B', updatedAt: Date.now() - 2000 },
    ];

    const freshSearch = createFreshSearch<TestItem>({}, (item) => item.name);
    const results = freshSearch(items, '');

    // All items should be returned
    expect(results.length).toBe(2);
  });

  it('should filter items that do not match query', () => {
    const items: TestItem[] = [
      { name: 'Apple', updatedAt: Date.now() },
      { name: 'Banana', updatedAt: Date.now() },
      { name: 'Cherry', updatedAt: Date.now() },
    ];

    const freshSearch = createFreshSearch<TestItem>({}, (item) => item.name);
    const results = freshSearch(items, 'Banana');

    // Only matching items should be returned
    expect(results.length).toBe(1);
    expect(results[0].item.name).toBe('Banana');
  });
});
