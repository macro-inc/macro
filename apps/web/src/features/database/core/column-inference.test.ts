import { describe, expect, it } from 'vitest';
import {
  inferDatabaseNumber,
  inferDatabasePercentage,
  parseMonetaryInput,
  percentagePointsText,
} from './column-inference';

describe('first-entry number inference', () => {
  it.each(['42', '-12.5', ' 0 ', '1e3', '.5', '-.5', '1.'])(
    'recognizes %s',
    (value) => {
      expect(inferDatabaseNumber(value)).toBe(Number(value));
    }
  );
  it.each([
    '',
    '00123',
    '000',
    '12 apples',
    '1,200',
    '1/2',
    'Infinity',
    'NaN',
    '9007199254740993',
    '1e999',
  ])('preserves %s as text', (value) => {
    expect(inferDatabaseNumber(value)).toBeUndefined();
  });
});

describe('percentage points', () => {
  it('stores typing 25 as 0.25', () => {
    expect(inferDatabasePercentage('25')).toBe(0.25);
    expect(inferDatabasePercentage('25%')).toBe(0.25);
    expect(inferDatabasePercentage(' 12.5 % ')).toBe(0.125);
  });
  it('edits a stored fraction as percentage points', () => {
    expect(percentagePointsText(0.25)).toBe('25');
    expect(percentagePointsText(0.1)).toBe('10');
  });
});

describe('explicit monetary input', () => {
  it.each<[string, string, number]>([
    ['de-DE', '12,5', 12.5],
    ['de-DE', '-1.234,56789', -1234.56789],
    ['de-DE', '12.5', 12.5],
    ['de-DE', '1.234', 1.234],
    ['en-US', '1,234.5', 1234.5],
    ['es-ES', '1.234,5', 1234.5],
    ['fr-FR', '1\u202f234,5', 1234.5],
    ['hi-IN', '12,34,567.5', 1234567.5],
    ['ar-EG', '١٢٫٥', 12.5],
  ])(
    'reads %s input %s without changing canonical decimals',
    (locale, text, expected) => {
      expect(parseMonetaryInput(text, locale)).toBe(expected);
    }
  );

  it.each([
    ['en-US', '12,3'],
    ['en-US', '1.2,3'],
    ['de-DE', '12.34,5'],
    ['de-DE', '0012,5'],
    ['de-DE', '12,5 EUR'],
    ['de-DE', '9.007.199.254.740.993'],
  ])('rejects malformed or unsafe %s input %s', (locale, text) => {
    expect(parseMonetaryInput(text, locale)).toBeUndefined();
  });
});
