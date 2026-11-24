import { describe, expect, it } from 'vitest';
import { periodName, periodRange, weekRange } from './time-period';

describe('periodRange', () => {
  it('starts a week on the calendar preference', () => {
    expect(weekRange('2026-11-24', 0)).toEqual({
      from: '2026-11-22',
      to: '2026-11-28',
    });
    expect(weekRange('2026-11-24', 1)).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  it('reads last week across a month end', () => {
    expect(periodRange('last-week', '2026-12-02', 1)).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  it('reads whole months and years', () => {
    expect(periodRange('this-month', '2026-11-24', 0)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(periodRange('last-month', '2026-01-15', 0)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('this-year', '2028-02-29', 0)).toEqual({
      from: '2028-01-01',
      to: '2028-12-31',
    });
  });
});

describe('periodName', () => {
  it('names a month, adding the year only when it is another year', () => {
    const today = '2026-01-15';
    expect(
      periodName('this-month', periodRange('this-month', today, 0), today, 'en')
    ).toBe('January');
    expect(
      periodName('last-month', periodRange('last-month', today, 0), today, 'en')
    ).toBe('December 2025');
  });

  it('names a week by its first and last days', () => {
    const today = '2026-11-24';
    expect(
      periodName('this-week', periodRange('this-week', today, 1), today, 'en')
    ).toMatch(/^Nov 23\s–\s29$/);
  });
});
