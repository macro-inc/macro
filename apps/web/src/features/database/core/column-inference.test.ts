import { describe, expect, it } from 'vitest';
import { inferDatabaseNumber } from './column-inference';

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
