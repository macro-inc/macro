import { describe, expect, it } from 'vitest';
import type { EntityData } from '@entity';
import { intersectEntityPools } from './search-utils';

const makeEntity = (id: string, name = id): EntityData =>
  ({
    type: 'document',
    id,
    name,
    ownerId: 'test',
    fileType: 'md',
  }) as EntityData;

describe('intersectEntityPools', () => {
  it('returns empty array for no pools', () => {
    expect(intersectEntityPools([])).toEqual([]);
  });

  it('returns the single pool as-is', () => {
    const pool = [makeEntity('a'), makeEntity('b')];
    expect(intersectEntityPools([pool])).toBe(pool);
  });

  it('returns entities present in all pools', () => {
    const a = makeEntity('a');
    const b = makeEntity('b');
    const c = makeEntity('c');

    const result = intersectEntityPools([
      [a, b, c],
      [b, c],
      [c, b],
    ]);

    expect(result.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('returns empty when pools have no overlap', () => {
    const result = intersectEntityPools([[makeEntity('a')], [makeEntity('b')]]);

    expect(result).toEqual([]);
  });

  it('deduplicates within a pool', () => {
    const a = makeEntity('a');

    const result = intersectEntityPools([[a, a, a], [a]]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('keeps the first occurrence of a duplicated entity', () => {
    const a1 = makeEntity('a', 'first');
    const a2 = makeEntity('a', 'second');

    const result = intersectEntityPools([[a1], [a2]]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('first');
  });
});
