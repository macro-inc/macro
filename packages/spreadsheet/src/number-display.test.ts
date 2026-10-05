import { describe, expect, it } from 'vitest';
import { literalNumber, literalNumberDisplay } from './number-display';

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
