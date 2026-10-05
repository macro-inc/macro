import { describe, expect, it } from 'vitest';
import { BOOLEAN_ITEMS, booleanItem } from './boolean';

describe('boolean operations', () => {
  it('names Exclude as the file format does', () => {
    expect(booleanItem('XOR').label).toBe('Exclude');
    expect(booleanItem('SUBTRACT').key).toBe('S');
  });

  it('treats a boolean without an operation as a union', () => {
    expect(booleanItem(null).operation).toBe('UNION');
    expect(BOOLEAN_ITEMS.map((b) => b.key)).toEqual(['U', 'S', 'I', 'X']);
  });
});
