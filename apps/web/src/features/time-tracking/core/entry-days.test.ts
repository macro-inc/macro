import { describe, expect, it } from 'vitest';
import { dayBefore, dayName, groupByDay, localDay } from './entry-days';

describe('entry days', () => {
  it('names today and yesterday by the device calendar, across a month', () => {
    expect(localDay(new Date(2026, 10, 20, 23, 59))).toBe('2026-11-20');
    expect(dayBefore('2026-12-01')).toBe('2026-11-30');
    expect(dayName('2026-11-20', '2026-11-20')).toEqual({ kind: 'today' });
    expect(dayName('2026-11-19', '2026-11-20')).toEqual({ kind: 'yesterday' });
    expect(dayName('2026-11-17', '2026-11-20').kind).toBe('date');
  });

  it('groups consecutive entries of a day and totals them in order', () => {
    const entries = [
      { id: 'a', date: '2026-11-20', minutes: 42 },
      { id: 'b', date: '2026-11-20', minutes: 90 },
      { id: 'c', date: '2026-11-19', minutes: 120 },
    ];
    expect(groupByDay(entries)).toEqual([
      { day: '2026-11-20', minutes: 132, entries: [entries[0], entries[1]] },
      { day: '2026-11-19', minutes: 120, entries: [entries[2]] },
    ]);
    expect(groupByDay([])).toEqual([]);
  });
});
