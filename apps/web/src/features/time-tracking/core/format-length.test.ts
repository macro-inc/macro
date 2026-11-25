import { describe, expect, it } from 'vitest';
import { formatLength } from './format-length';

describe('formatLength', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [120, '2h'],
    [90, '1h 30m'],
    [275, '4h 35m'],
    [1440, '24h'],
    [0, '0m'],
  ])('reads %i minutes as %s', (minutes, expected) => {
    expect(formatLength(minutes)).toBe(expected);
  });
});
