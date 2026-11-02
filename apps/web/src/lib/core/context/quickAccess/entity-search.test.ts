import { describe, expect, it } from 'vitest';
import {
  filterQuickAccessItems,
  searchQuickAccessItems,
} from './entity-search';
import type { EntityItem, UserItem } from './types';

function items(...names: string[]): UserItem[] {
  return names.map((name, index) => ({
    id: String(index),
    kind: 'user',
    bucket: 'person',
    searchText: name,
    sortTimestamp: 0,
    timestamps: {},
    data: { id: String(index), name, email: `${index}@macro.com` },
  }));
}

describe('pending Quick Access matches', () => {
  it('keeps cache order and row identity even when the legacy ranker would reorder them', () => {
    const ranked = items(
      'Seamus snip',
      'seamus todo',
      'seamus@macro.com taskium'
    );
    for (const query of ['seam', 'seamu', 'seamus', 'seamu']) {
      const matches = filterQuickAccessItems(ranked, query);
      expect(matches).toEqual(ranked);
      expect(matches[0]).toBe(ranked[0]);
    }
  });

  it.each([
    ['Some early afternoon music', 'seamu', true],
    ['Seamus snip', ' SNIP\tSEAMU ', true],
    ['Seamus snip', 'seamux', false],
    ['Seamus snip', 'suames', false],
    ['a😀b🎵c', '😀🎵', true],
    ['a😀b🎵c', '🎵😀', false],
    ['Alpha', 'aa', true],
    ['Alpha', 'aaa', false],
    ['Avery Morgan, Blair Chen', 'Blair, aver', true],
    ['Avery Morgan, Blair Chen', 'Blair,Avery', true],
    ['Avery Morgan, Blair Chen', 'Blair, casey', false],
  ])(
    'matches cache subsequence semantics for %s and %s',
    (name, query, matches) => {
      const ranked = items(name);
      expect(filterQuickAccessItems(ranked, query)).toEqual(
        matches ? ranked : []
      );
    }
  );

  it('preserves the full list when the query is cleared', () => {
    const ranked = items('Seamus snip', 'other');
    expect(filterQuickAccessItems(ranked, ' \t ')).toBe(ranked);
  });
});

describe('local Quick Access search', () => {
  function channel(id: string, bucket: 'channel' | 'dm', name: string) {
    const item: EntityItem = {
      id,
      kind: 'entity',
      bucket,
      searchText: name,
      sortTimestamp: 0,
      timestamps: {},
      data: {
        id,
        type: 'channel',
        name,
        ownerId: 'owner',
        channelType: bucket === 'dm' ? 'direct_message' : 'private',
      },
    };
    return item;
  }

  it('finds channels and DMs by names typed in any order', () => {
    const items = [
      channel('group', 'channel', 'Avery Morgan, Blair Chen'),
      channel('dm', 'dm', 'Blair Chen'),
    ];
    const found = (query: string) =>
      searchQuickAccessItems(items, query).map((item) => item.id);

    expect(found('Blair, Avery')).toEqual(['group']);
    expect(found('chen blair')).toEqual(['group', 'dm']);
  });
});
