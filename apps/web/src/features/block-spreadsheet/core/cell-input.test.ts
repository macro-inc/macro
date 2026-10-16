import { describe, expect, it } from 'vitest';
import { cellEditValue, cellInputEdit } from './cell-input';

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
    expect(
      cellInputEdit(input, { value: '', format: 'percent' }, 'en-US')
    ).toEqual({ value: expected });
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
      expect(
        cellInputEdit(input, { value: '', format: 'percent' }, 'en-US')
      ).toEqual({ value: input });
    }
  );

  it('respects imported Excel percentage formats without treating literal percent labels as numeric formats', () => {
    expect(
      cellInputEdit(
        '5',
        { value: '', numberFormat: '0.00%;[Red](0.00%)' },
        'en-US'
      ).value
    ).toBe('5%');
    for (const numberFormat of ['0"%"', '0\\%', '0" percent"', '0.00']) {
      expect(cellInputEdit('5', { value: '', numberFormat }, 'en-US')).toEqual({
        value: '5',
      });
    }
    expect(
      cellInputEdit('5', { value: '', format: 'number' }, 'en-US').value
    ).toBe('5');
    expect(
      cellInputEdit(
        '5',
        { value: '', format: 'text', numberFormat: '0%' },
        'en-US'
      ).value
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
      expect(cellEditValue(cell, 'en-US')).toBe(expected);
      expect(
        cellInputEdit(cellEditValue(cell, 'en-US'), cell, 'en-US').value
      ).toBe(expected);
    }
  );
});

describe('date cell entry', () => {
  it('stores a typed date as its serial, shown like the typed text', () => {
    expect(cellInputEdit('01/2026', undefined, 'en-US')).toEqual({
      value: '46023',
      format: 'date',
      numberFormat: 'mmm yyyy',
    });
    expect(cellInputEdit('Jan 01 2026', { value: 'x' }, 'en-US')).toEqual({
      value: '46023',
      format: 'date',
      numberFormat: 'mmm dd, yyyy',
    });
    expect(cellInputEdit('1/1/26', undefined, 'en-US')).toEqual({
      value: '46023',
      format: 'date',
    });
    expect(cellInputEdit('1/2/2026', undefined, 'en-GB')).toEqual({
      value: '46054',
      format: 'date',
      numberFormat: 'd/m/yyyy',
    });
  });

  it('turns a number format into a date format for a typed date', () => {
    expect(
      cellInputEdit(
        'Jan 2026',
        { value: '', format: 'currency', decimals: 0 },
        'en-US'
      )
    ).toEqual({ value: '46023', format: 'date', numberFormat: 'mmm yyyy' });
  });

  it('keeps the format of a cell that already shows dates', () => {
    for (const cell of [
      { value: '', format: 'date' as const },
      { value: '', format: 'date' as const, numberFormat: 'yyyy-mm-dd' },
      { value: '', numberFormat: 'd-mmm-yy' },
    ])
      expect(cellInputEdit('Jan 2026', cell, 'en-US')).toEqual({
        value: '46023',
      });
  });

  it('leaves text cells, formulas and other text as typed', () => {
    expect(
      cellInputEdit('1/1/2026', { value: '', format: 'text' }, 'en-US')
    ).toEqual({ value: '1/1/2026' });
    expect(cellInputEdit('=DATE(2026,1,1)', undefined, 'en-US')).toEqual({
      value: '=DATE(2026,1,1)',
    });
    expect(cellInputEdit("'Jan 2026", undefined, 'en-US')).toEqual({
      value: "'Jan 2026",
    });
    expect(cellInputEdit('Q1 2026', undefined, 'en-US')).toEqual({
      value: 'Q1 2026',
    });
  });

  it('edits a stored date in the locale’s order and reads it back unchanged', () => {
    const cell = {
      value: '46085',
      format: 'date' as const,
      numberFormat: 'mmm yyyy',
    };
    expect(cellEditValue(cell, 'en-US')).toBe('3/4/2026');
    expect(cellEditValue(cell, 'en-GB')).toBe('4/3/2026');
    for (const locale of ['en-US', 'en-GB'])
      expect(cellInputEdit(cellEditValue(cell, locale), cell, locale)).toEqual({
        value: '46085',
      });
  });

  it('edits date times, formulas and text in date cells as stored', () => {
    for (const value of ['46085.25', '=TODAY()', 'TBD'])
      expect(cellEditValue({ value, format: 'date' }, 'en-US')).toBe(value);
    expect(cellEditValue({ value: '46085' }, 'en-US')).toBe('46085');
  });
});
