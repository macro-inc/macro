import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import { formulaCompletion } from './formula';

const column = (id: string, name: string): DatabaseViewColumn => ({
  id,
  name,
  dataType: 'NUMBER',
  isMultiSelect: false,
  options: [],
  writable: true,
});
const columns = [
  column('testa', 'Testa'),
  column('price', 'Unit price'),
  column('latest', 'Latest total'),
];

describe('formula completion', () => {
  it('offers columns starting with the word being typed, then those containing it', () => {
    expect(formulaCompletion('te', 2, columns)).toEqual({
      start: 0,
      matches: [columns[0], columns[2]],
    });
    expect(formulaCompletion('Testa * un', 10, columns)).toEqual({
      start: 8,
      matches: [columns[1]],
    });
  });

  it('completes a braced name, spaces included', () => {
    expect(formulaCompletion('2 * {unit p', 11, columns)).toEqual({
      start: 4,
      matches: [columns[1]],
    });
    expect(formulaCompletion('{', 1, columns)?.matches).toEqual(columns);
  });

  it('offers nothing after an operator, a complete name or a closed brace', () => {
    expect(formulaCompletion('Testa * ', 8, columns)).toBeUndefined();
    expect(formulaCompletion('testa', 5, columns)).toBeUndefined();
    expect(formulaCompletion('{Unit price}', 12, columns)).toBeUndefined();
    expect(formulaCompletion('zz', 2, columns)).toBeUndefined();
  });
});
