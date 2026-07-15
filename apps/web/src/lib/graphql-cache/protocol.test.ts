import { describe, expect, it } from 'vitest';
import {
  MAX_INDEXED_ENTITY_PAGE_SIZE,
  normalizeIndexedEntityLimit,
} from './protocol';

describe('normalizeIndexedEntityLimit', () => {
  it('accepts integers and clamps oversized pages', () => {
    expect(normalizeIndexedEntityLimit(25)).toBe(25);
    expect(normalizeIndexedEntityLimit(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_INDEXED_ENTITY_PAGE_SIZE
    );
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid limit %s', (limit) => {
    expect(() => normalizeIndexedEntityLimit(limit)).toThrow(
      'indexed entity limit must be a non-negative integer'
    );
  });
});
