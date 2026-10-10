import { describe, expect, it } from 'vitest';
import {
  deriveGanttRange,
  ganttBarGeometry,
  ganttDateFromDay,
  ganttTicks,
  ganttYearTicks,
  normalizeGanttRange,
  toGanttDay,
} from './gantt-date';

const day = (value: string) => toGanttDay(value)!;
const range = { start: day('2026-03-01'), end: day('2026-04-01') };

describe('Gantt calendar geometry', () => {
  it('preserves date-only values and rejects calendar overflow instead of normalizing it', () => {
    expect(day('2024-02-29') + 1).toBe(day('2024-03-01'));
    for (const value of [
      '2026-02-29',
      '2026-02-30T12:00:00Z',
      '2026-13-01',
      '2026-00-01',
      '0',
      'invalid',
    ]) {
      expect(toGanttDay(value)).toBeUndefined();
    }
    expect(toGanttDay(new Date(Number.NaN))).toBeUndefined();
    expect(day('0001-01-01')).toBeLessThan(day('0100-01-01'));
  });

  it('writes the same local calendar day across DST changes and early years', () => {
    for (const value of ['2026-03-08', '2026-11-01', '0001-01-01']) {
      const ordinal = day(value);
      expect(toGanttDay(ganttDateFromDay(ordinal))).toBe(ordinal);
      expect(ganttDateFromDay(ordinal).getHours()).toBe(0);
    }
  });

  it('uses calendar-day distances across local daylight-saving transitions', () => {
    const before = new Date(2026, 2, 7, 12);
    const after = new Date(2026, 2, 9, 12);
    expect(toGanttDay(after)! - toGanttDay(before)!).toBe(2);
    expect(toGanttDay(before.toISOString())).toBe(toGanttDay(before));
    expect(
      toGanttDay(new Date(2026, 10, 2))! - toGanttDay(new Date(2026, 9, 31))!
    ).toBe(2);
  });

  it('includes the deadline day and keeps same-day intervals visible', () => {
    expect(
      ganttBarGeometry({ start: '2026-03-08', end: '2026-03-08' }, range, 40)
    ).toMatchObject({
      kind: 'scheduled',
      left: 280,
      width: 40,
    });
    expect(
      ganttBarGeometry({ start: '2026-03-07', end: '2026-03-09' }, range, 20)
    ).toMatchObject({
      kind: 'scheduled',
      width: 60,
    });
  });

  it('distinguishes open-ended intervals from invalid and reversed deadlines', () => {
    expect(ganttBarGeometry({ start: '2026-03-08' }, range, 20)).toMatchObject({
      kind: 'open-ended',
      width: 480,
      end: undefined,
    });
    expect(
      ganttBarGeometry({ start: '2026-03-08', end: 'invalid' }, range, 20)
    ).toEqual({ kind: 'invalid-end' });
    expect(
      ganttBarGeometry({ start: '2026-03-08', end: '2026-03-07' }, range, 20)
    ).toEqual({ kind: 'reversed' });
    expect(ganttBarGeometry({ start: null }, range, 20)).toEqual({
      kind: 'missing-start',
    });
    expect(ganttBarGeometry({ start: 'invalid' }, range, 20)).toEqual({
      kind: 'invalid-start',
    });
  });

  it('clips both range boundaries without drawing intervals outside the chart', () => {
    expect(
      ganttBarGeometry({ start: '2026-02-01', end: '2026-04-15' }, range, 6)
    ).toMatchObject({
      kind: 'scheduled',
      left: 0,
      width: 186,
    });
    expect(
      ganttBarGeometry({ start: '2026-01-01', end: '2026-02-28' }, range, 6)
    ).toEqual({ kind: 'outside' });
    expect(ganttBarGeometry({ start: '2026-04-01' }, range, 6)).toEqual({
      kind: 'outside',
    });
  });

  it('includes today but excludes a reversed deadline from derived bounds', () => {
    expect(
      deriveGanttRange(
        [
          { start: '2026-03-01', end: '2000-01-01' },
          { start: '2026-03-10', end: '2026-04-15' },
          { start: 'invalid', end: 'invalid' },
        ],
        '2026-03-08'
      )
    ).toEqual({ start: day('2026-02-22'), end: day('2026-04-30') });
    const empty = deriveGanttRange([], '2026-03-08');
    expect(empty.end - empty.start).toBe(22);
    expect(normalizeGanttRange({ start: 12.5, end: 8 })).toEqual({
      start: 12,
      end: 13,
    });
    const invalid = normalizeGanttRange({ start: Number.NaN, end: Infinity });
    expect(Number.isFinite(invalid.start)).toBe(true);
    expect(invalid.end).toBeGreaterThan(invalid.start);
  });

  it('uses real calendar months across leap years and clips partial months', () => {
    const months = ganttTicks(
      { start: day('2024-02-10'), end: day('2024-04-05') },
      'month'
    );
    expect(months.map((tick) => tick.end - tick.start)).toEqual([20, 31, 4]);
    const weeks = ganttTicks(range, 'week', {
      start: day('2026-03-11'),
      end: day('2026-03-15'),
    });
    expect(weeks).toHaveLength(1);
    expect(weeks[0].start).toBe(day('2026-03-09'));
    expect(weeks[0].end).toBe(day('2026-03-17'));
    expect(weeks[0].label).toBe('9');
  });

  it.each([
    ['2023-02-01', '2023-03-01', [7, 7, 7, 7], ['1', '8', '15', '22']],
    ['2024-02-01', '2024-03-01', [7, 8, 7, 7], ['1', '8', '16', '23']],
    ['2026-04-01', '2026-05-01', [8, 7, 8, 7], ['1', '9', '16', '24']],
    ['2026-03-01', '2026-04-01', [8, 8, 7, 8], ['1', '9', '17', '24']],
  ] as const)(
    'balances week-scale sections in %s without changing calendar dates',
    (start, end, lengths, labels) => {
      const ticks = ganttTicks({ start: day(start), end: day(end) }, 'week');
      expect(ticks.map((tick) => tick.end - tick.start)).toEqual(lengths);
      expect(ticks.map((tick) => tick.label)).toEqual(labels);
      expect(ticks.at(-1)?.end).toBe(day(end));
    }
  );

  it('keeps month-aligned sections stable across clipped ranges and year boundaries', () => {
    const bounds = { start: day('2026-12-30'), end: day('2027-01-10') };
    expect(
      ganttTicks(bounds, 'week', {
        start: day('2026-12-31'),
        end: day('2027-01-05'),
      })
    ).toEqual([
      { start: day('2026-12-30'), end: day('2027-01-01'), label: '30' },
      { start: day('2027-01-01'), end: day('2027-01-09'), label: '1' },
    ]);
    expect(
      ganttTicks(bounds, 'week', { start: day('2027-01-09'), end: bounds.end })
    ).toEqual([{ start: day('2027-01-09'), end: bounds.end, label: '9' }]);
  });

  it('separates year markers across December and January without enumerating offscreen years', () => {
    const bounds = { start: day('2000-01-01'), end: day('2050-01-01') };
    const visible = { start: day('2026-12-20'), end: day('2027-02-10') };
    const months = ganttTicks(bounds, 'month', visible);
    expect(months.map((tick) => tick.label)).toEqual([
      'December',
      'January',
      'February',
    ]);
    expect(ganttYearTicks(bounds, visible)).toEqual([
      { start: day('2026-01-01'), end: day('2027-01-01'), label: '2026' },
      { start: day('2027-01-01'), end: day('2028-01-01'), label: '2027' },
    ]);
    expect(
      ganttYearTicks({ start: day('2026-12-31'), end: day('2027-01-02') })
    ).toEqual([
      { start: day('2026-12-31'), end: day('2027-01-01'), label: '2026' },
      { start: day('2027-01-01'), end: day('2027-01-02'), label: '2027' },
    ]);
    expect(
      ganttYearTicks(bounds, {
        start: day('2027-01-31'),
        end: day('2027-02-10'),
      })
    ).toEqual(
      ganttYearTicks(bounds, {
        start: day('2027-02-01'),
        end: day('2027-03-10'),
      })
    );
    expect(
      ganttYearTicks(bounds, { start: bounds.end, end: bounds.end + 1 })
    ).toEqual([]);
  });
  it('bounds tick generation to the visible window and guards enormous inputs', () => {
    const long = { start: day('2000-01-01'), end: day('2050-01-01') };
    const visible = { start: day('2026-03-01'), end: day('2026-03-11') };
    expect(ganttTicks(long, 'day', visible)).toHaveLength(10);
    expect(ganttTicks(long, 'day')).toHaveLength(1_000);
    expect(ganttTicks(long, 'week')).toHaveLength(1_000);
    expect(
      ganttTicks(range, 'week', { start: range.end, end: range.end + 7 })
    ).toEqual([]);
  });
});
