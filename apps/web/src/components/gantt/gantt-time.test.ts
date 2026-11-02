import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toGanttDay } from './gantt-date';
import {
  formatGanttInstant,
  formatGanttTimeRange,
  formatGanttWeekday,
  ganttHourStep,
  ganttHourTicks,
  ganttInstant,
  ganttPosition,
  ganttTimedBarGeometry,
  ganttTimedCreation,
  ganttTimeSnap,
  rescheduledGanttTimes,
  snapGanttInstant,
} from './gantt-time';

// These run in New York: clocks spring forward on 2026-03-08 and fall back
// on 2026-11-01.
const systemTimeZone = process.env.TZ;
const october9 = toGanttDay('2026-10-09')!;
const march8 = toGanttDay('2026-03-08')!;
const november1 = toGanttDay('2026-11-01')!;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ now: new Date(2026, 9, 21, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = systemTimeZone;
});

describe('local time positions', () => {
  it('places an instant by the share of its local day elapsed', () => {
    expect(ganttPosition(new Date(2026, 9, 9))).toBe(october9);
    expect(ganttPosition(new Date(2026, 9, 9, 12))).toBe(october9 + 0.5);
    expect(ganttPosition(new Date(2026, 9, 9, 18))).toBe(october9 + 0.75);
    expect(ganttInstant(october9 + 0.75)).toEqual(new Date(2026, 9, 9, 18));
  });

  it('fits a 23-hour and a 25-hour day into one day without gaps', () => {
    // Midnight to 3 AM on the spring-forward day is two real hours of 23.
    expect(ganttPosition(new Date(2026, 2, 8, 3))).toBeCloseTo(march8 + 2 / 23);
    expect(ganttPosition(new Date(2026, 2, 9))).toBe(march8 + 1);
    // Noon on the fall-back day is thirteen real hours of 25.
    expect(ganttPosition(new Date(2026, 10, 1, 12))).toBeCloseTo(
      november1 + 13 / 25
    );
    for (const instant of [
      new Date(2026, 2, 8, 1, 59),
      new Date(2026, 2, 8, 3, 30),
      new Date(2026, 10, 1, 1, 30),
      new Date(2026, 10, 1, 23, 45),
    ])
      expect(ganttInstant(ganttPosition(instant)).getTime()).toBeCloseTo(
        instant.getTime(),
        -1
      );
  });

  it('snaps to the nearest local wall-clock step', () => {
    expect(snapGanttInstant(new Date(2026, 9, 9, 9, 7), 15)).toEqual(
      new Date(2026, 9, 9, 9, 0)
    );
    expect(snapGanttInstant(new Date(2026, 9, 9, 9, 8), 15)).toEqual(
      new Date(2026, 9, 9, 9, 15)
    );
    expect(snapGanttInstant(new Date(2026, 9, 9, 23, 40), 60)).toEqual(
      new Date(2026, 9, 10)
    );
    expect(snapGanttInstant(new Date(2026, 2, 8, 3, 50), 60)).toEqual(
      new Date(2026, 2, 8, 4)
    );
  });
});

describe('snapping by zoom', () => {
  it('moves timed bars by days, hours or quarter hours as the zoom closes in', () => {
    expect(ganttTimeSnap('month')).toBe('day');
    expect(ganttTimeSnap('week')).toBe('day');
    expect(ganttTimeSnap('day')).toBe(60);
    expect(ganttTimeSnap('hour')).toBe(15);
  });
});

describe('rescheduling a timed range', () => {
  // Built per test, once the test's time zone is set.
  const times = () => ({
    start: new Date(2026, 9, 9, 9),
    end: new Date(2026, 9, 13, 17),
  });

  it('moves by whole days keeping both times, across a clock change', () => {
    expect(
      rescheduledGanttTimes(times(), 'move', october9, october9 + 2.4, 'day')
    ).toEqual({
      start: new Date(2026, 9, 11, 9),
      end: new Date(2026, 9, 15, 17),
    });
    expect(
      rescheduledGanttTimes(
        { start: new Date(2026, 2, 7, 9), end: new Date(2026, 2, 7, 17) },
        'move',
        march8 - 1,
        march8,
        'day'
      )
    ).toEqual({
      start: new Date(2026, 2, 8, 9),
      end: new Date(2026, 2, 8, 17),
    });
  });

  it('moves by snapped quarter hours keeping the duration', () => {
    // Ten minutes later snaps the start to 9:15.
    const moved = rescheduledGanttTimes(
      times(),
      'move',
      october9,
      october9 + 10 / 1440,
      15
    );
    expect(moved).toEqual({
      start: new Date(2026, 9, 9, 9, 15),
      end: new Date(2026, 9, 13, 17, 15),
    });
    expect(
      rescheduledGanttTimes(times(), 'move', october9, october9 + 3 / 24, 60)
    ).toEqual({
      start: new Date(2026, 9, 9, 12),
      end: new Date(2026, 9, 13, 20),
    });
  });

  it('resizes one edge, stopping a step short of the other', () => {
    expect(
      rescheduledGanttTimes(times(), 'end', october9, october9 - 1.1, 15)
    ).toEqual({ start: times().start, end: new Date(2026, 9, 12, 14, 30) });
    expect(
      rescheduledGanttTimes(times(), 'start', october9, october9 + 9, 15)
    ).toEqual({ start: new Date(2026, 9, 13, 16, 45), end: times().end });
    expect(
      rescheduledGanttTimes(times(), 'end', october9, october9 - 9, 60)
    ).toEqual({ start: times().start, end: new Date(2026, 9, 9, 10) });
  });

  it('resizes by whole days without passing the other end', () => {
    expect(
      rescheduledGanttTimes(times(), 'end', october9, october9 - 2, 'day')
    ).toEqual({ start: times().start, end: new Date(2026, 9, 11, 17) });
    expect(
      rescheduledGanttTimes(times(), 'end', october9, october9 - 9, 'day')
    ).toEqual({ start: times().start, end: new Date(2026, 9, 9, 17) });
    expect(
      rescheduledGanttTimes(times(), 'start', october9, october9 + 9, 'day')
    ).toEqual({ start: new Date(2026, 9, 13, 9), end: times().end });
  });
});

describe('timed bars and creation', () => {
  const range = { start: october9 - 1, end: october9 + 30 };

  it('draws a timed bar between its instants, never too thin to grab', () => {
    expect(
      ganttTimedBarGeometry(
        { start: new Date(2026, 9, 9, 6), end: new Date(2026, 9, 9, 18) },
        range,
        480
      )
    ).toEqual({
      kind: 'scheduled',
      left: 600,
      width: 240,
      start: october9 + 0.25,
      end: october9 + 0.75,
    });
    expect(
      ganttTimedBarGeometry(
        { start: new Date(2026, 9, 9, 9), end: new Date(2026, 9, 9, 9, 30) },
        range,
        20
      )
    ).toMatchObject({ kind: 'scheduled', width: 6 });
    expect(
      ganttTimedBarGeometry(
        { start: new Date(2026, 9, 9, 18), end: new Date(2026, 9, 9, 6) },
        range,
        20
      )
    ).toEqual({ kind: 'reversed' });
    expect(
      ganttTimedBarGeometry(
        { start: new Date(2026, 8, 1), end: new Date(2026, 8, 2) },
        range,
        20
      )
    ).toEqual({ kind: 'outside' });
  });

  it('creates quarter hours from a drag in either direction, at least one', () => {
    expect(
      ganttTimedCreation(october9 + 17.1 / 24, october9 + 9.05 / 24)
    ).toEqual({
      start: new Date(2026, 9, 9, 9),
      end: new Date(2026, 9, 9, 17),
    });
    expect(ganttTimedCreation(october9 + 9 / 24, october9 + 9.05 / 24)).toEqual(
      {
        start: new Date(2026, 9, 9, 9),
        end: new Date(2026, 9, 9, 9, 15),
      }
    );
  });
});

describe('hour ticks', () => {
  it('spaces hour labels so they never overlap', () => {
    expect(ganttHourStep(120)).toBe(12);
    expect(ganttHourStep(240)).toBe(6);
    expect(ganttHourStep(480)).toBe(3);
    expect(ganttHourStep(960)).toBe(2);
    expect(ganttHourStep(1_152)).toBe(1);
    for (const pixels of [120, 200, 400, 700, 1_000, 1_440])
      expect((ganttHourStep(pixels) * pixels) / 24).toBeGreaterThanOrEqual(44);
  });

  it('labels the hours between midnights of the visible days', () => {
    const day = { start: october9, end: october9 + 1 };
    expect(ganttHourTicks(day, 240)).toEqual([
      { position: october9 + 0.25, label: '6 AM' },
      { position: october9 + 0.5, label: '12 PM' },
      { position: october9 + 0.75, label: '6 PM' },
    ]);
    expect(
      ganttHourTicks({ start: october9 - 5, end: october9 + 5 }, 120, day)
    ).toEqual([{ position: october9 + 0.5, label: '12 PM' }]);
  });

  it('skips the hour clocks spring past and places the rest by real time', () => {
    const ticks = ganttHourTicks({ start: march8, end: march8 + 1 }, 1_152);
    expect(ticks.map((tick) => tick.label).slice(0, 3)).toEqual([
      '1 AM',
      '3 AM',
      '4 AM',
    ]);
    expect(ticks[1].position).toBeCloseTo(march8 + 2 / 23);
    expect(ticks).toHaveLength(22);
  });
});

describe('time formats', () => {
  it('names days and ranges with their times', () => {
    expect(formatGanttWeekday(october9)).toBe('Fri, Oct 9');
    expect(
      formatGanttTimeRange({
        start: new Date(2026, 9, 9, 9),
        end: new Date(2026, 9, 13, 17),
      })
    ).toBe('Oct 9, 9 AM → Oct 13, 5 PM');
    expect(
      formatGanttTimeRange({
        start: new Date(2026, 9, 9, 9),
        end: new Date(2026, 9, 9, 17, 30),
      })
    ).toBe('Oct 9, 9 AM – 5:30 PM');
    expect(
      formatGanttTimeRange({
        start: new Date(2025, 11, 31, 22),
        end: new Date(2026, 0, 1, 2),
      })
    ).toBe('Dec 31, 2025, 10 PM → Jan 1, 2 AM');
    expect(formatGanttInstant(new Date(2026, 9, 9, 9))).toBe(
      'Fri, Oct 9, 9:00 AM'
    );
  });
});
