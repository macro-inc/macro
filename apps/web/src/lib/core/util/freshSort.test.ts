import { describe, expect, it } from 'vitest';
import { applyDurationToDate } from './dateSearch/dateParser';
import { createFreshSearch, normalizeFuzzyScore } from './freshSort';

interface MockItem {
  id: string;
  name: string;
  type: 'item' | 'channel';
  viewedAt?: Date;
  updatedAt?: Date;
  lastInteraction?: Date;
}

interface User extends MockItem {
  email: string;
}

function createSearch(opts: { useViewedAt?: boolean; channelBoost?: number }) {
  return createFreshSearch<MockItem>({
    config: {
      useViewedAt: opts.useViewedAt,
      channelBoost: opts.channelBoost,
      timeWeight: 0.9,
      fuzzyWeight: 0.1,
    },
    getName: (item) => item.name,
    isChannelItem: (item) => item.type === 'channel',
    getTimestamp: (item) => ({
      viewedAt: item.viewedAt,
      updatedAt: item.updatedAt,
    }),
  });
}

describe('freshSort ordering', () => {
  it('orders by viewedAt - most recent first', () => {
    const now = new Date();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'Meeting Notes',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'h' }),
      },
      {
        id: '2',
        name: 'Project Plan',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '3',
        name: 'Old Draft',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'd' }),
      },
    ];

    const search = createSearch({ useViewedAt: true });
    const results = search(items, '');

    expect(results.map((r) => r.item.id)).toEqual(['2', '1', '3']);
  });

  it('boosts channels above documents when searching', () => {
    const now = new Date();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'Design Doc',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '2',
        name: 'Design Channel',
        type: 'channel',
        viewedAt: applyDurationToDate(now, {
          value: -5,
          unit: 'min',
        }),
      },
    ];

    const search = createSearch({ useViewedAt: true, channelBoost: 2.0 });
    const results = search(items, 'Design');

    expect(results[0].item.type).toBe('channel');
  });

  it('mixes documents and channels by recency without boost', () => {
    const now = new Date();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'Doc A',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'h' }),
      },
      {
        id: '2',
        name: 'Channel B',
        type: 'channel',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '3',
        name: 'Doc C',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'd' }),
      },
    ];

    const search = createSearch({ useViewedAt: true, channelBoost: 1.0 });
    const results = search(items, '');

    expect(results.map((r) => r.item.id)).toEqual(['2', '1', '3']);
  });
});

describe('createFreshSearch with comma-separated channel matching', () => {
  function createCommaSeparatedSearch() {
    return createFreshSearch<MockItem>({
      config: {
        commaSeparatedChannelMatch: true,
        fuzzyWeight: 0.9,
        timeWeight: 0.1,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });
  }

  it('matches channel with comma-separated query', () => {
    const now = new Date();
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
    const now = new Date();
    const items: MockItem[] = [
      { id: '1', name: 'Nick Noble,teo,hutch', type: 'channel', viewedAt: now },
    ];

    const search = createCommaSeparatedSearch();
    const results = search(items, 'teo,nick');

    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('uses regular fuzzy search when query has no commas', () => {
    const now = new Date();
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
    const now = new Date();
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
    const now = new Date();
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
    const now = new Date();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'Design',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'h' }),
      },
      {
        id: '2',
        name: 'Design',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '3',
        name: 'Design',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 'd' }),
      },
      { id: '4', name: 'Design', type: 'item', viewedAt: now },
    ];

    const search = createFreshSearch<MockItem>({
      config: {
        useViewedAt: true,
        fuzzyWeight: 0.5,
        timeWeight: 0.5,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

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
    const now = new Date();
    const items: MockItem[] = [
      {
        id: '1',
        name: 'Design',
        type: 'item',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
      {
        id: '2',
        name: 'Design',
        type: 'channel',
        viewedAt: applyDurationToDate(now, { value: -5, unit: 's' }),
      },
    ];

    const search = createFreshSearch<MockItem>({
      config: {
        useViewedAt: true,
        fuzzyWeight: 0.8,
        timeWeight: 0.2,
        channelBoost: 2.0,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, 'Design');

    expect(results).toHaveLength(2);
    expect(results[0].item.type).toBe('channel');
  });
});

describe('boostFn functionality', () => {
  interface MockItemWithEmail extends MockItem {
    email?: string;
  }

  it('applies per-item boost correctly', () => {
    const now = new Date();
    const items: MockItemWithEmail[] = [
      {
        id: '1',
        name: 'Alice Johnson',
        type: 'item',
        email: 'alice@example.com',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
      {
        id: '2',
        name: 'Bob Smith',
        type: 'item',
        email: 'bob@macro.com',
        viewedAt: applyDurationToDate(now, { value: -5, unit: 's' }),
      },
      {
        id: '3',
        name: 'Charlie Brown',
        type: 'item',
        email: 'charlie@example.com',
        viewedAt: applyDurationToDate(now, { value: -3, unit: 's' }),
      },
    ];

    const currentUserDomain = 'macro.com';
    const search = createFreshSearch<MockItemWithEmail>({
      config: {
        fuzzyWeight: 0.8,
        timeWeight: 0.2,
        boostFn: (item) => {
          const itemDomain = item.email?.split('@')[1];
          return itemDomain === currentUserDomain ? 1.0 : 0; // 100% boost for same domain
        },
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, 'o'); // All three match with 'o' in their names

    // Bob should be boosted to the top despite being older, because of same domain boost
    expect(results[0].item.id).toBe('2');
  });

  it('boostFn works with search query', () => {
    const now = new Date();
    const items: MockItemWithEmail[] = [
      {
        id: '1',
        name: 'Alice Johnson',
        type: 'item',
        email: 'alice@example.com',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
      {
        id: '2',
        name: 'Alicia Smith',
        type: 'item',
        email: 'alicia@macro.com',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
    ];

    const currentUserDomain = 'macro.com';
    const search = createFreshSearch<MockItemWithEmail>({
      config: {
        fuzzyWeight: 0.8,
        timeWeight: 0.2,
        boostFn: (item) => {
          const itemDomain = item.email?.split('@')[1];
          return itemDomain === currentUserDomain ? 0.5 : 0;
        },
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, 'Ali');

    // Both match the query, but Alicia should rank higher due to domain boost
    expect(results).toHaveLength(2);
    expect(results[0].item.id).toBe('2');
  });

  it('handles boostFn returning 0 for no boost', () => {
    const now = new Date();
    const items: MockItemWithEmail[] = [
      {
        id: '1',
        name: 'Alice',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '2',
        name: 'Bob',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -2,
          unit: 'min',
        }),
      },
    ];

    const search = createFreshSearch<MockItemWithEmail>({
      config: {
        fuzzyWeight: 0.5,
        timeWeight: 0.5,
        boostFn: () => 0, // No boost
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, '');

    // Should sort by recency (Alice more recent)
    expect(results[0].item.id).toBe('1');
  });

  it('combines boostFn with channelBoost', () => {
    const now = new Date();
    const items: MockItemWithEmail[] = [
      {
        id: '1',
        name: 'Design Doc',
        type: 'item',
        email: 'alice@macro.com',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
      {
        id: '2',
        name: 'Design Channel',
        type: 'channel',
        email: 'system@example.com',
        viewedAt: applyDurationToDate(now, { value: -1, unit: 's' }),
      },
    ];

    const search = createFreshSearch<MockItemWithEmail>({
      config: {
        fuzzyWeight: 0.5,
        timeWeight: 0.5,
        channelBoost: 1.5,
        boostFn: (item) => {
          const itemDomain = item.email?.split('@')[1];
          return itemDomain === 'macro.com' ? 0.3 : 0;
        },
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, 'Design');

    // With both boosts combined, channel may still win depending on weights
    expect(results).toHaveLength(2);
  });

  it('works without boostFn (undefined)', () => {
    const now = new Date();
    const items: MockItemWithEmail[] = [
      {
        id: '1',
        name: 'Alice',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
      {
        id: '2',
        name: 'Bob',
        type: 'item',
        viewedAt: applyDurationToDate(now, {
          value: -2,
          unit: 'min',
        }),
      },
    ];

    const search = createFreshSearch<MockItemWithEmail>({
      config: {
        fuzzyWeight: 0.5,
        timeWeight: 0.5,
        // boostFn is undefined
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({
        viewedAt: item.viewedAt,
        updatedAt: item.updatedAt,
      }),
    });

    const results = search(items, '');

    // Should sort normally by recency
    expect(results[0].item.id).toBe('1');
  });
});

describe('DM activity timestamps for user ranking', () => {
  it('ranks users with recent DM activity higher', () => {
    const now = new Date();
    const users: User[] = [
      {
        id: '1',
        name: 'Alice Johnson',
        type: 'item',
        email: 'alice@example.com',
        lastInteraction: applyDurationToDate(now, {
          value: -1,
          unit: 'd',
        }),
      },
      {
        id: '2',
        name: 'Bob Smith',
        type: 'item',
        email: 'bob@example.com',
        lastInteraction: applyDurationToDate(now, {
          value: -1,
          unit: 'h',
        }),
      },
      {
        id: '3',
        name: 'Charlie Brown',
        type: 'item',
        email: 'charlie@example.com',
        // No DM activity
      },
    ];

    const search = createFreshSearch<User>({
      config: {
        fuzzyWeight: 0.6,
        timeWeight: 0.3,
        brevityWeight: 0.1,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({ lastInteraction: item.lastInteraction }),
    });

    const results = search(users, '');

    // Bob should rank highest (most recent interaction)
    // Then Alice (older interaction)
    // Then Charlie (no interaction)
    expect(results[0].item.id).toBe('2');
    expect(results[1].item.id).toBe('1');
    expect(results[2].item.id).toBe('3');
  });

  it('combines DM activity with fuzzy search', () => {
    const now = new Date();
    const users: User[] = [
      {
        id: '1',
        name: 'Alice Anderson',
        type: 'item',
        email: 'alice@example.com',
        lastInteraction: applyDurationToDate(now, {
          value: -1,
          unit: 'd',
        }),
      },
      {
        id: '2',
        name: 'Alicia Martinez',
        type: 'item',
        email: 'alicia@example.com',
        lastInteraction: applyDurationToDate(now, {
          value: -1,
          unit: 'h',
        }),
      },
      {
        id: '3',
        name: 'Bob Wilson',
        type: 'item',
        email: 'bob@example.com',
        lastInteraction: applyDurationToDate(now, {
          value: -1,
          unit: 'min',
        }),
      },
    ];

    const search = createFreshSearch<User>({
      config: {
        fuzzyWeight: 0.6,
        timeWeight: 0.3,
        brevityWeight: 0.1,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({ lastInteraction: item.lastInteraction }),
    });

    const results = search(users, 'Ali');

    // Both Alice and Alicia match, but Alicia has more recent interaction
    expect(results).toHaveLength(2);
    expect(results[0].item.id).toBe('2');
    expect(results[1].item.id).toBe('1');
  });

  it('handles users without lastInteraction gracefully', () => {
    const users: User[] = [
      {
        id: '1',
        name: 'Alice',
        type: 'item',
        email: 'alice@example.com',
        // No lastInteraction
      },
      {
        id: '2',
        name: 'Bob',
        type: 'item',
        email: 'bob@example.com',
        // No lastInteraction
      },
    ];

    const search = createFreshSearch<User>({
      config: {
        fuzzyWeight: 0.6,
        timeWeight: 0.3,
        brevityWeight: 0.1,
      },
      getName: (item) => item.name,
      isChannelItem: (item) => item.type === 'channel',
      getTimestamp: (item) => ({ lastInteraction: item.lastInteraction }),
    });

    const results = search(users, '');

    // Should not throw, and should return both users
    expect(results).toHaveLength(2);
  });
});
