import { format as formatExcelNumber } from 'ssf';
import { describe, expect, it } from 'vitest';
import {
  accountingParts,
  displayNumber,
  literalNumber,
  literalNumberDisplay,
} from './number-display';

describe('literal number display', () => {
  it('formats imported literals as calculation will', () => {
    expect(
      literalNumberDisplay({ value: '45292', numberFormat: 'm/d/yyyy' })
    ).toBe('1/1/2024');
    expect(
      literalNumberDisplay({ value: '1234.5', numberFormat: '"$"#,##0.00' })
    ).toBe('$1,234.50');
    expect(literalNumberDisplay({ value: '0.25', format: 'percent' })).toBe(
      '25%'
    );
    expect(literalNumberDisplay({ value: '-42', format: 'accounting' })).toBe(
      '$(42.00)'
    );
    expect(literalNumberDisplay({ value: '1234.5' })).toBe('1234.5');
  });

  it('leaves formulas, text and text-formatted numbers alone', () => {
    for (const cell of [
      { value: '=A1' },
      { value: 'Revenue' },
      { value: '42', format: 'text' as const },
      { value: '' },
    ]) {
      expect(literalNumber(cell)).toBeUndefined();
      expect(literalNumberDisplay(cell)).toBeUndefined();
    }
  });
});

describe('accounting display', () => {
  const accounting = (number: number, decimals?: number) =>
    displayNumber(number, { value: '', format: 'accounting', decimals });

  it('puts negatives in parentheses and shows a dash for zero', () => {
    expect(accounting(1234.5)).toBe('$1,234.50');
    expect(accounting(-1234.5)).toBe('$(1,234.50)');
    expect(accounting(0)).toBe('$-');
    expect(accounting(0.001)).toBe('$0.00');
    expect(accounting(-0.001)).toBe('$(0.00)');
    expect(accounting(1234.5, 0)).toBe('$1,235');
    expect(accounting(-1234.5678, 3)).toBe('$(1,234.568)');
  });

  it('shows what Excel shows for the format code it exports', () => {
    const codes = [
      [2, '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'],
      [0, '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
    ] as const;
    for (const [decimals, code] of codes)
      for (const number of [1234.5, -1234.5, 0, 0.001, -0.001, 1e9])
        expect(accounting(number, decimals)).toBe(
          formatExcelNumber(code, number).trim()
        );
  });

  it('lays the symbol and the amount out at the cell edges', () => {
    expect(accountingParts('$1,234.50')).toEqual({
      symbol: '$',
      amount: '1,234.50',
      padding: ')',
    });
    expect(accountingParts(' $(1,234.50)')).toEqual({
      symbol: '$',
      amount: '(1,234.50)',
      padding: '',
    });
    expect(accountingParts('$-')).toEqual({
      symbol: '$',
      amount: '-',
      padding: '00)',
    });
    expect(accountingParts(' $-   ', 0)).toEqual({
      symbol: '$',
      amount: '-',
      padding: ')',
    });
    expect(accountingParts('1,234.50 €')).toBeUndefined();
    expect(accountingParts('-$1.00')).toBeUndefined();
    expect(accountingParts('$')).toBeUndefined();
  });
});
