import { describe, expect, it } from 'vitest';
import { cellEditValue, normalizeCellInput } from './cell-input';

describe('percentage cell entry', () => {
  it.each([
    ['5', '5%'],
    ['-5', '-5%'],
    ['0.5', '0.5%'],
    ['.25', '.25%'],
    [' 12.5 ', '12.5%'],
    ['1e-3', '1e-3%'],
    ['0', '0%'],
  ])('treats typed %s as percentage points', (input, expected) => {
    expect(normalizeCellInput(input, { value: '', format: 'percent' })).toBe(
      expected
    );
  });

  it.each([
    '=A1/100',
    '=SUM(A1:A4)',
    '5%',
    "'5",
    'revenue',
    '',
    '1/2',
    'Infinity',
  ])(
    'does not reinterpret formula, explicit percentage, or text %s',
    (input) => {
      expect(normalizeCellInput(input, { value: '', format: 'percent' })).toBe(
        input
      );
    }
  );

  it('respects imported Excel percentage formats without treating literal percent labels as numeric formats', () => {
    expect(
      normalizeCellInput('5', { value: '', numberFormat: '0.00%;[Red](0.00%)' })
    ).toBe('5%');
    for (const numberFormat of ['0"%"', '0\\%', '0" percent"', '0.00']) {
      expect(normalizeCellInput('5', { value: '', numberFormat })).toBe('5');
    }
    expect(normalizeCellInput('5', { value: '', format: 'number' })).toBe('5');
    expect(
      normalizeCellInput('5', { value: '', format: 'text', numberFormat: '0%' })
    ).toBe('5');
  });

  it.each([
    ['0.05', '5%'],
    ['0.07', '7%'],
    ['-0.025', '-2.5%'],
    ['0', '0%'],
    ['5%', '5%'],
    ['=B1/C1', '=B1/C1'],
  ])(
    'shows stored %s as %s when editing without double scaling',
    (value, expected) => {
      const cell = { value, format: 'percent' as const };
      expect(cellEditValue(cell)).toBe(expected);
      expect(normalizeCellInput(cellEditValue(cell), cell)).toBe(expected);
    }
  );
});
