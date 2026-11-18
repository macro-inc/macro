import { describe, expect, it } from 'vitest';
import { dayLabel, eventSchedule, groupByDay, overlaps } from './event-time';

const NOW = new Date(2026, 9, 9, 12, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const timed = (startsAt: string, endsAt: string) =>
  ({ kind: 'timed', startsAt, endsAt }) as const;
const allDay = (startDate: string, endDate: string) =>
  ({ kind: 'allDay', startDate, endDate }) as const;

describe('an event schedule', () => {
  it('names a same-day range once per meridiem, on the hour without minutes', () => {
    expect(eventSchedule(timed(at(9, 15), at(9, 15, 30)), NOW)?.time).toBe(
      '3 – 3:30 PM'
    );
    expect(eventSchedule(timed(at(9, 11), at(9, 13)), NOW)?.time).toBe(
      '11 AM – 1 PM'
    );
  });

  it('names both days of a range that crosses midnight', () => {
    expect(eventSchedule(timed(at(9, 22), at(10, 9)), NOW)?.time).toBe(
      'Oct 9, 10 PM – Oct 10, 9 AM'
    );
  });

  it('reads an all-day end date as exclusive', () => {
    expect(eventSchedule(allDay('2026-10-09', '2026-10-10'), NOW)?.time).toBe(
      'All day'
    );
    expect(eventSchedule(allDay('2026-10-09', '2026-10-12'), NOW)?.time).toBe(
      'All day · until Sun, Oct 11'
    );
  });

  it('knows whether the event is over', () => {
    expect(eventSchedule(timed(at(9, 9), at(9, 10)), NOW)?.past).toBe(true);
    expect(eventSchedule(timed(at(9, 15), at(9, 16)), NOW)?.past).toBe(false);
    expect(eventSchedule(allDay('2026-10-09', '2026-10-10'), NOW)?.past).toBe(
      false
    );
  });

  it('gives up on a time it cannot read', () => {
    expect(eventSchedule(timed('soon', 'later'), NOW)).toBeUndefined();
    expect(eventSchedule(allDay('Oct 9', 'Oct 10'), NOW)).toBeUndefined();
  });
});

describe('agenda days', () => {
  it('name the days around today and date the rest', () => {
    expect(dayLabel(new Date(2026, 9, 9), NOW)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 10), NOW)).toBe('Tomorrow');
    expect(dayLabel(new Date(2026, 9, 8), NOW)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 13), NOW)).toBe('Tue, Oct 13');
    expect(dayLabel(new Date(2027, 0, 4), NOW)).toBe('Mon, Jan 4, 2027');
  });

  it('group events by the day they start, all-day first', () => {
    const entry = (
      name: string,
      time: Parameters<typeof eventSchedule>[0]
    ) => ({
      name,
      schedule: eventSchedule(time, NOW)!,
    });
    const days = groupByDay(
      [
        entry('review', timed(at(10, 15), at(10, 16))),
        entry('standup', timed(at(9, 9), at(9, 9, 15))),
        entry('offsite', allDay('2026-10-10', '2026-10-11')),
        entry('lunch', timed(at(9, 12), at(9, 13))),
      ],
      NOW
    );
    expect(
      days.map((day) => [day.label, day.entries.map((e) => e.name)])
    ).toEqual([
      ['Today', ['standup', 'lunch']],
      ['Tomorrow', ['offsite', 'review']],
    ]);
  });
});

describe('overlapping events', () => {
  const minute = 60_000;
  const base = new Date(2026, 9, 9, 14, 30).getTime();
  const span = (from: number, to: number, allDay = false) => ({
    day: new Date(base),
    start: base + from * minute,
    end: base + to * minute,
    time: '',
    allDay,
    past: false,
  });

  it('are flagged against the event each runs into, by how long', () => {
    const clashes = overlaps([span(0, 45), span(30, 60), span(90, 120)]);
    expect(clashes.get(0)).toEqual({ with: 1, minutes: 15 });
    expect(clashes.get(1)).toEqual({ with: 0, minutes: 15 });
    expect(clashes.has(2)).toBe(false);
  });

  it('leave all-day events out: a day off is not a clash', () => {
    expect(overlaps([span(0, 1440, true), span(30, 60)]).size).toBe(0);
  });
});
