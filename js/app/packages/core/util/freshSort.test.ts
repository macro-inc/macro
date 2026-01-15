import { describe, expect, it } from 'vitest';
import { createFreshSearch } from './freshSort';
import { fuzzyScoreCommaSeparated, fuzzyTestCommaSeparated } from './fuzzy';

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

describe('fuzzyTestCommaSeparated', () => {
  it('matches when all query parts match text parts', () => {
    expect(fuzzyTestCommaSeparated('nick,hutch', 'Nick Noble,teo,hutch')).toBe(
      true
    );
  });

  it('matches regardless of order', () => {
    expect(fuzzyTestCommaSeparated('teo,nick', 'Nick Noble,teo,hutch')).toBe(
      true
    );
  });

  it('matches single query term against multi-part name', () => {
    expect(fuzzyTestCommaSeparated('teo', 'Nick Noble,teo,hutch')).toBe(true);
  });

  it('does not match when a query part is missing', () => {
    expect(fuzzyTestCommaSeparated('nick,alice', 'Nick Noble,teo,hutch')).toBe(
      false
    );
  });

  it('handles fuzzy matching within parts', () => {
    expect(fuzzyTestCommaSeparated('nob,teo', 'Nick Noble,teo,hutch')).toBe(
      true
    );
  });

  it('handles whitespace around commas', () => {
    expect(
      fuzzyTestCommaSeparated('nick , hutch', 'Nick Noble , teo , hutch')
    ).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(fuzzyTestCommaSeparated('', 'Nick Noble,teo,hutch')).toBe(true);
  });
});

describe('fuzzyScoreCommaSeparated', () => {
  it('returns score between 0 and 1', () => {
    const score = fuzzyScoreCommaSeparated('nick,teo', 'Nick Noble,teo,hutch');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns -1 when no match', () => {
    const score = fuzzyScoreCommaSeparated('alice,bob', 'Nick Noble,teo,hutch');
    expect(score).toBe(-1);
  });

  it('returns 1 for empty query', () => {
    const score = fuzzyScoreCommaSeparated('', 'Nick Noble,teo,hutch');
    expect(score).toBe(1);
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
});
