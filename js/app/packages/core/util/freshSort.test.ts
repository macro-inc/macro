import { describe, expect, it } from 'vitest';
import { createFreshSearch, normalizeFuzzyScore } from './freshSort';

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

describe('createFreshSearch with comma-separated channel matching', () => {
  function createCommaSeparatedSearch() {
    return createFreshSearch<MockItem>(
      {
        commaSeparatedChannelMatch: true,
        fuzzyWeight: 0.9,
        timeWeight: 0.1,
      },
      (item) => item.name
    );
  }

  it('matches channel with comma-separated query', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Nick Noble,teo,hutch', type: 'channel', viewedAt: now },
      { id: '2', name: 'Alice,Bob', type: 'channel', viewedAt: now },
    ];

    const search = createCommaSeparatedSearch();
    const results = search(items, 'nick,hutch');

    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('matches channel regardless of query order', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Nick Noble,teo,hutch', type: 'channel', viewedAt: now },
    ];

    const search = createCommaSeparatedSearch();
    const results = search(items, 'teo,nick');

    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('uses regular fuzzy search when query has no commas', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Nick Noble,teo,hutch', type: 'channel', viewedAt: now },
      { id: '2', name: 'Design Doc', type: 'item', viewedAt: now },
    ];

    const search = createCommaSeparatedSearch();
    const results = search(items, 'Nick');

    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('still matches non-channel items with comma queries', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Nick Noble,teo,hutch', type: 'channel', viewedAt: now },
      {
        id: '2',
        name: 'nick,hutch meeting notes',
        type: 'item',
        viewedAt: now,
      },
    ];

    const search = createCommaSeparatedSearch();
    const results = search(items, 'nick,hutch');

    // Both should match - channel via comma-separated, item via regular fuzzy
    expect(results.length).toBe(2);
  });

  it('matches channel with space-separated query in any order', () => {
    const now = Date.now();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'jackson kustec, gabriel birman, jacob, eric hayes',
        type: 'channel',
        viewedAt: now,
      },
      { id: '2', name: 'Other Channel', type: 'channel', viewedAt: now },
    ];

    const search = createCommaSeparatedSearch();

    const results1 = search(items, 'jackson jacob');
    expect(results1.length).toBe(1);
    expect(results1[0].item.id).toBe('1');

    const results2 = search(items, 'jacob jackson');
    expect(results2.length).toBe(1);
    expect(results2[0].item.id).toBe('1');
  });
});

describe('normalizeFuzzyScore', () => {
  it('normalizes regular scores correctly', () => {
    const result = normalizeFuzzyScore(50, 100);
    expect(result).toBe(0.5);
  });

  it('clamps scores to [0, 1] range', () => {
    expect(normalizeFuzzyScore(-10, 100)).toBe(0);
    expect(normalizeFuzzyScore(150, 100)).toBe(1);
  });

  it('handles edge cases', () => {
    expect(normalizeFuzzyScore(0, 100)).toBe(0);
    expect(normalizeFuzzyScore(100, 100)).toBe(1);
    expect(normalizeFuzzyScore(0, 1)).toBe(0);
  });

  it('throws error for Infinity fuzzyScore', () => {
    expect(() => normalizeFuzzyScore(Infinity, 100)).toThrow(
      'fuzzyScore must be a finite number'
    );
  });

  it('throws error for invalid maxPossibleScore', () => {
    expect(() => normalizeFuzzyScore(50, Infinity)).toThrow(
      'maxPossibleScore must be a finite positive number'
    );
    expect(() => normalizeFuzzyScore(50, 0)).toThrow(
      'maxPossibleScore must be a finite positive number'
    );
    expect(() => normalizeFuzzyScore(50, -10)).toThrow(
      'maxPossibleScore must be a finite positive number'
    );
  });
});

describe('freshSort with all exact matches', () => {
  it('sorts by recency when all items are exact matches (Infinity scores)', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Design', type: 'item', viewedAt: now - 3600000 }, // 1hr ago
      { id: '2', name: 'Design', type: 'item', viewedAt: now - 60000 }, // 1min ago
      { id: '3', name: 'Design', type: 'item', viewedAt: now - 86400000 }, // 1day ago
      { id: '4', name: 'Design', type: 'item', viewedAt: now - 1000 }, // 1sec ago
    ];

    const search = createFreshSearch<MockItem>(
      {
        useViewedAt: true,
        fuzzyWeight: 0.5,
        timeWeight: 0.5,
      },
      (item) => item.name
    );

    const results = search(items, 'Design');

    expect(results).toHaveLength(4);
    expect(results[0].item.id).toBe('4');
    expect(results[1].item.id).toBe('2');
    expect(results[2].item.id).toBe('1');
    expect(results[3].item.id).toBe('3');

    for (const result of results) {
      expect(result.fuzzyScore).toBeGreaterThan(0);
      expect(Number.isFinite(result.fuzzyScore)).toBe(true);
    }
  });

  it('channel boost works correctly with all exact matches', () => {
    const now = Date.now();
    const items: MockItem[] = [
      { id: '1', name: 'Design', type: 'item', viewedAt: now - 1000 },
      { id: '2', name: 'Design', type: 'channel', viewedAt: now - 5000 },
    ];

    const search = createFreshSearch<MockItem>(
      {
        useViewedAt: true,
        fuzzyWeight: 0.8,
        timeWeight: 0.2,
        channelBoost: 2.0,
      },
      (item) => item.name
    );

    const results = search(items, 'Design');

    expect(results).toHaveLength(2);
    expect(results[0].item.type).toBe('channel');
  });
});
