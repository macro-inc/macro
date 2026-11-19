import { describe, expect, it } from 'vitest';
import { inputValueText } from './routine-sub-routine-definitions';

describe('a copy’s values as its page shows them', () => {
  it('shows a number with every digit it was given', () => {
    expect(inputValueText(0.0004)).toBe('0.0004');
    expect(inputValueText(1.23456)).toBe('1.23456');
    expect(inputValueText(1234.5)).toBe('1,234.5');
  });

  it('shows text as it is and yes or no for a boolean', () => {
    expect(inputValueText('Ship the deck')).toBe('Ship the deck');
    expect(inputValueText(true)).toBe('Yes');
    expect(inputValueText(false)).toBe('No');
  });
});
