import { describe, expect, it } from 'vitest';
import { inputValueText } from './routine-sub-routine-definitions';

describe('a copy’s values as its page shows them', () => {
  it('shows a number with every digit it was given', () => {
    expect(inputValueText(0.0004)).toBe('0.0004');
    expect(inputValueText(1.23456)).toBe('1.23456');
    expect(inputValueText(1234.5)).toBe('1,234.5');
    expect(inputValueText(0.1)).toBe('0.1');
    expect(inputValueText(0.30000000000000004)).toBe('0.30000000000000004');
    // Past what the format can show: its shortest form.
    expect(inputValueText(1e-21)).toBe('1e-21');
    expect(inputValueText(1e21)).toBe('1e+21');
    expect(inputValueText(0.0000012345678901234567)).toBe(
      '0.0000012345678901234567'
    );
  });

  it('shows text as it is and yes or no for a boolean', () => {
    expect(inputValueText('Ship the deck')).toBe('Ship the deck');
    expect(inputValueText(true)).toBe('Yes');
    expect(inputValueText(false)).toBe('No');
  });
});
