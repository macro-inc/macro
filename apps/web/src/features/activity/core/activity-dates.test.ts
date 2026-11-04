import { addDays, eachDayOfInterval, format } from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatOverviewDate,
  OVERVIEW_TZ,
  parseOverviewDate,
} from './activity-dates';
import { buildContributionGrid } from './contribution-grid';
import { placeholderOverview } from './placeholder-overview';

afterEach(() => vi.unstubAllEnvs());

describe('overview calendar dates', () => {
  it('keeps date arithmetic in UTC across viewer daylight saving changes', () => {
    const start = parseOverviewDate('2026-03-08');
    const next = addDays(start, 1);
    expect(next.getTime() - start.getTime()).toBe(86_400_000);
    expect(formatOverviewDate(next)).toBe('2026-03-09');
    expect(format(start, 'EEE, MMM d, yyyy', { in: OVERVIEW_TZ })).toBe(
      'Sun, Mar 8, 2026'
    );
  });

  it('includes leap day without shifting the server date window', () => {
    const grid = buildContributionGrid({
      from: '2024-02-28',
      to: '2024-03-02',
      days: [{ date: '2024-02-29', count: 2 }],
    });
    expect(grid.weeks.flat().filter((day) => day !== null)).toEqual([
      { date: '2024-02-28', count: 0, intensity: 0 },
      { date: '2024-02-29', count: 2, intensity: 4 },
      { date: '2024-03-01', count: 0, intensity: 0 },
    ]);
  });
});

it.each(['UTC', 'America/New_York', 'Pacific/Auckland'])(
  'preserves calendar windows and skeleton length in %s',
  (zone) => {
    vi.stubEnv('TZ', zone);
    for (const dates of [
      ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'],
      ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'],
      ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
    ]) {
      const from = parseOverviewDate(dates[0]);
      const last = parseOverviewDate(dates[3]);
      expect(
        eachDayOfInterval({ start: from, end: last }, { in: OVERVIEW_TZ }).map(
          formatOverviewDate
        )
      ).toEqual(dates);
      const grid = buildContributionGrid({
        from: dates[0],
        to: formatOverviewDate(addDays(last, 1)),
        days: [],
      });
      expect(
        grid.weeks.flatMap((week) =>
          week.flatMap((day) => (day ? [day.date] : []))
        )
      ).toEqual(dates);
    }
    for (const month of [2, 10]) {
      const overview = placeholderOverview(new Date(2026, month, 9, 12));
      expect(
        (parseOverviewDate(overview.to).getTime() -
          parseOverviewDate(overview.from).getTime()) /
          86_400_000
      ).toBe(365);
      expect(overview.to).toBe(month === 2 ? '2026-03-10' : '2026-11-10');
    }
  }
);

it('rejects invalid calendar dates rather than normalizing them into the next month', () => {
  expect(Number.isNaN(parseOverviewDate('2026-02-30').getTime())).toBe(true);
  expect(() => formatOverviewDate(parseOverviewDate('2026-02-30'))).toThrow(
    RangeError
  );
});
