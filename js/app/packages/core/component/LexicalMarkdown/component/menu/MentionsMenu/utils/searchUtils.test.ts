import { describe, it, expect } from 'vitest';
import {
  getDomainFromEmail,
  separateTabResults,
  deduplicateById,
  mergeAndDeduplicateResults,
  excludeCurrentBlock,
  matchesPrefix,
  filterGroups,
} from './searchUtils';

describe('getDomainFromEmail', () => {
  it('extracts domain from a valid email', () => {
    expect(getDomainFromEmail('user@example.com')).toBe('example.com');
  });

  it('extracts domain from email with subdomain', () => {
    expect(getDomainFromEmail('user@mail.example.com')).toBe(
      'mail.example.com'
    );
  });

  it('returns undefined for empty string', () => {
    expect(getDomainFromEmail('')).toBeUndefined();
  });

  it('handles email with multiple @ symbols (returns after first @)', () => {
    expect(getDomainFromEmail('user@domain@example.com')).toBe(
      'domain@example.com'
    );
  });
});

describe('separateTabResults', () => {
  it('separates items into tab and other results', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
      { id: '3', name: 'Item 3' },
      { id: '4', name: 'Item 4' },
    ];
    const openTabIds = new Set(['2', '4']);

    const result = separateTabResults(items, openTabIds);

    expect(result.tabResults).toEqual([
      { id: '2', name: 'Item 2' },
      { id: '4', name: 'Item 4' },
    ]);
    expect(result.otherResults).toEqual([
      { id: '1', name: 'Item 1' },
      { id: '3', name: 'Item 3' },
    ]);
  });

  it('returns all items as otherResults when no tabs are open', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];
    const openTabIds = new Set<string>();

    const result = separateTabResults(items, openTabIds);

    expect(result.tabResults).toEqual([]);
    expect(result.otherResults).toEqual(items);
  });

  it('returns all items as tabResults when all are open tabs', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];
    const openTabIds = new Set(['1', '2']);

    const result = separateTabResults(items, openTabIds);

    expect(result.tabResults).toEqual(items);
    expect(result.otherResults).toEqual([]);
  });

  it('handles empty items array', () => {
    const items: Array<{ id: string }> = [];
    const openTabIds = new Set(['1', '2']);

    const result = separateTabResults(items, openTabIds);

    expect(result.tabResults).toEqual([]);
    expect(result.otherResults).toEqual([]);
  });
});

describe('deduplicateById', () => {
  it('removes duplicate items keeping first occurrence', () => {
    const items = [
      { id: '1', value: 'first' },
      { id: '2', value: 'second' },
      { id: '1', value: 'duplicate' },
      { id: '3', value: 'third' },
    ];

    const result = deduplicateById(items);

    expect(result).toEqual([
      { id: '1', value: 'first' },
      { id: '2', value: 'second' },
      { id: '3', value: 'third' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateById([])).toEqual([]);
  });

  it('returns same array when no duplicates', () => {
    const items = [
      { id: '1', value: 'first' },
      { id: '2', value: 'second' },
    ];

    const result = deduplicateById(items);

    expect(result).toEqual(items);
  });

  it('handles array with all duplicates', () => {
    const items = [
      { id: '1', value: 'first' },
      { id: '1', value: 'second' },
      { id: '1', value: 'third' },
    ];

    const result = deduplicateById(items);

    expect(result).toEqual([{ id: '1', value: 'first' }]);
  });
});

describe('mergeAndDeduplicateResults', () => {
  it('merges local and remote results, deduplicating by id', () => {
    const local = [
      { id: '1', source: 'local' },
      { id: '2', source: 'local' },
    ];
    const remote = [
      { id: '2', source: 'remote' },
      { id: '3', source: 'remote' },
    ];

    const result = mergeAndDeduplicateResults(local, remote);

    expect(result).toEqual([
      { id: '1', source: 'local' },
      { id: '2', source: 'local' },
      { id: '3', source: 'remote' },
    ]);
  });

  it('returns only local results when remote is empty', () => {
    const local = [{ id: '1', source: 'local' }];
    const remote: Array<{ id: string; source: string }> = [];

    const result = mergeAndDeduplicateResults(local, remote);

    expect(result).toEqual(local);
  });

  it('returns only remote results when local is empty', () => {
    const local: Array<{ id: string; source: string }> = [];
    const remote = [{ id: '1', source: 'remote' }];

    const result = mergeAndDeduplicateResults(local, remote);

    expect(result).toEqual(remote);
  });

  it('prefers local results over remote (local appears first)', () => {
    const local = [{ id: '1', value: 'local-value' }];
    const remote = [{ id: '1', value: 'remote-value' }];

    const result = mergeAndDeduplicateResults(local, remote);

    expect(result).toEqual([{ id: '1', value: 'local-value' }]);
  });
});

describe('excludeCurrentBlock', () => {
  it('excludes item with matching currentBlockId', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
      { id: '3', name: 'Item 3' },
    ];

    const result = excludeCurrentBlock(items, '2');

    expect(result).toEqual([
      { id: '1', name: 'Item 1' },
      { id: '3', name: 'Item 3' },
    ]);
  });

  it('returns all items when currentBlockId is undefined', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];

    const result = excludeCurrentBlock(items, undefined);

    expect(result).toEqual(items);
  });

  it('returns all items when currentBlockId does not match', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];

    const result = excludeCurrentBlock(items, '999');

    expect(result).toEqual(items);
  });

  it('handles empty items array', () => {
    const result = excludeCurrentBlock([], '1');
    expect(result).toEqual([]);
  });
});

describe('matchesPrefix', () => {
  it('returns true for matching prefix (case-insensitive)', () => {
    expect(matchesPrefix('Hello World', 'hello')).toBe(true);
    expect(matchesPrefix('Hello World', 'HELLO')).toBe(true);
    expect(matchesPrefix('Hello World', 'HeLLo')).toBe(true);
  });

  it('returns true for exact match', () => {
    expect(matchesPrefix('test', 'test')).toBe(true);
  });

  it('returns false for non-matching prefix', () => {
    expect(matchesPrefix('Hello World', 'World')).toBe(false);
  });

  it('returns true for empty prefix', () => {
    expect(matchesPrefix('anything', '')).toBe(true);
  });

  it('returns false when value is shorter than prefix', () => {
    expect(matchesPrefix('Hi', 'Hello')).toBe(false);
  });
});

describe('filterGroups', () => {
  const availableGroups = [
    { alias: 'here', match: (t: string) => t === '' || 'here'.startsWith(t) },
    {
      alias: 'channel',
      match: (t: string) => t === '' || 'channel'.startsWith(t),
    },
    {
      alias: 'everyone',
      match: (t: string) => t === '' || 'everyone'.startsWith(t),
    },
  ];

  it('returns all groups for empty search term', () => {
    const result = filterGroups(availableGroups, '');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      kind: 'group',
      id: 'here',
      data: { id: 'here', groupAlias: 'here' },
    });
  });

  it('filters groups by matching term', () => {
    const result = filterGroups(availableGroups, 'he');

    expect(result).toHaveLength(1);
    expect(result[0].data.groupAlias).toBe('here');
  });

  it('filters groups case-insensitively', () => {
    const result = filterGroups(availableGroups, 'CH');

    expect(result).toHaveLength(1);
    expect(result[0].data.groupAlias).toBe('channel');
  });

  it('returns empty array when no groups match', () => {
    const result = filterGroups(availableGroups, 'xyz');

    expect(result).toEqual([]);
  });

  it('returns multiple matching groups', () => {
    const groups = [
      { alias: 'here', match: (t: string) => t === '' || 'here'.startsWith(t) },
      { alias: 'help', match: (t: string) => t === '' || 'help'.startsWith(t) },
    ];

    const result = filterGroups(groups, 'he');

    expect(result).toHaveLength(2);
  });

  it('creates proper GroupMentionItem structure', () => {
    const result = filterGroups(availableGroups, 'here');

    expect(result[0]).toEqual({
      kind: 'group',
      id: 'here',
      data: {
        id: 'here',
        groupAlias: 'here',
      },
    });
  });
});
