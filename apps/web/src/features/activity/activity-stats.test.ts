import { describe, expect, it } from 'vitest';
import {
  formatDayLabel,
  formatMonthName,
  formatStreak,
  summarizeActivity,
} from './activity-stats';

describe('summarizeActivity', () => {
  it('returns empty peaks and zero streaks for an empty window', () => {
    expect(
      summarizeActivity({
        from: '2026-08-21',
        to: '2026-08-21',
        days: [{ date: '2026-08-20', count: 4 }],
      })
    ).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      mostActiveDay: null,
      mostActiveMonth: null,
    });
  });

  it('fills missing dates as zeros when computing streaks', () => {
    expect(
      summarizeActivity({
        from: '2026-08-18',
        to: '2026-08-22',
        days: [
          { date: '2026-08-18', count: 1 },
          { date: '2026-08-20', count: 2 },
          { date: '2026-08-21', count: 3 },
        ],
      })
    ).toEqual({
      currentStreak: 2,
      longestStreak: 2,
      mostActiveDay: '2026-08-21',
      mostActiveMonth: '2026-08',
    });
  });

  it('breaks the current streak when the last day is idle', () => {
    expect(
      summarizeActivity({
        from: '2026-08-18',
        to: '2026-08-22',
        days: [
          { date: '2026-08-18', count: 1 },
          { date: '2026-08-19', count: 1 },
          { date: '2026-08-20', count: 1 },
        ],
      })
    ).toEqual({
      currentStreak: 0,
      longestStreak: 3,
      mostActiveDay: '2026-08-20',
      mostActiveMonth: '2026-08',
    });
  });

  it('keeps a streak that crosses a month boundary', () => {
    expect(
      summarizeActivity({
        from: '2026-07-30',
        to: '2026-08-03',
        days: [
          { date: '2026-07-31', count: 2 },
          { date: '2026-08-01', count: 4 },
          { date: '2026-08-02', count: 1 },
        ],
      })
    ).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      mostActiveDay: '2026-08-01',
      mostActiveMonth: '2026-08',
    });
  });

  it('picks the later day and month when counts tie', () => {
    expect(
      summarizeActivity({
        from: '2026-07-01',
        to: '2026-09-01',
        days: [
          { date: '2026-07-15', count: 5 },
          { date: '2026-08-15', count: 5 },
        ],
      })
    ).toEqual({
      currentStreak: 0,
      longestStreak: 1,
      mostActiveDay: '2026-08-15',
      mostActiveMonth: '2026-08',
    });
  });
});

describe('activity stat labels', () => {
  it('formats month, day, and streak the way the card shows them', () => {
    expect(formatMonthName('2026-08')).toBe('August');
    expect(formatDayLabel('2026-08-21')).toBe('Aug 21, 2026');
    expect(formatStreak(2)).toBe('2d');
    expect(formatStreak(0)).toBe('0d');
  });
});
