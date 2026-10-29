import { describe, expect, it } from 'vitest';
import { formatActivityDate } from './chat';

const now = new Date(2026, 9, 26, 15, 0);

describe('formatActivityDate', () => {
  it('says Today and Yesterday for the last two days', () => {
    expect(
      formatActivityDate(new Date(2026, 9, 26, 9).toISOString(), now)
    ).toBe('Today');
    expect(
      formatActivityDate(new Date(2026, 9, 25, 23).toISOString(), now)
    ).toBe('Yesterday');
  });

  it('always includes the year otherwise', () => {
    expect(formatActivityDate(new Date(2026, 8, 2).toISOString(), now)).toBe(
      'Sep 2, 2026'
    );
    expect(formatActivityDate(new Date(2024, 7, 25).toISOString(), now)).toBe(
      'Aug 25, 2024'
    );
  });
});
