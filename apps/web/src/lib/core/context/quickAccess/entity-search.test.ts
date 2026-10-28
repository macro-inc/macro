import { describe, expect, it } from 'vitest';
import { filterQuickAccessItems } from './entity-search';
import type { UserItem } from './types';

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
