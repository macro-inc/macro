import { describe, expect, it } from 'vitest';
import { periodName, periodRange, weekName, weekRange } from './time-period';

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

  it('names last week with its year when it was in last year', () => {
    const today = '2027-01-02';
    expect(
      periodName('last-week', periodRange('last-week', today, 0), today, 'en')
    ).toMatch(/^Dec 20\s–\s26, 2026$/);
  });
});

describe('weekName', () => {
  it('leaves out the year for a week in this year', () => {
    expect(
      weekName({ from: '2026-11-23', to: '2026-11-29' }, '2026-11-24', 'en')
    ).toMatch(/^Nov 23\s–\s29$/);
  });

  it('names a week in another year with its year', () => {
    expect(
      weekName({ from: '2027-01-03', to: '2027-01-09' }, '2026-11-24', 'en')
    ).toMatch(/^Jan 3\s–\s9, 2027$/);
    expect(
      weekName({ from: '2025-11-23', to: '2025-11-29' }, '2026-11-24', 'en')
    ).toMatch(/^Nov 23\s–\s29, 2025$/);
  });

  it('names a week across two years with both', () => {
    expect(
      weekName({ from: '2026-12-27', to: '2027-01-02' }, '2026-11-24', 'en')
    ).toMatch(/^Dec 27, 2026\s–\sJan 2, 2027$/);
  });
});
