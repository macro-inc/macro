import { describe, expect, it } from 'vitest';
import { dayLabel, eventSchedule, groupByDay } from './event-time';

const NOW = new Date(2026, 9, 9, 12, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const timed = (startsAt: string, endsAt: string) =>
  ({ kind: 'timed', startsAt, endsAt }) as const;
const allDay = (startDate: string, endDate: string) =>
  ({ kind: 'allDay', startDate, endDate }) as const;

describe('an event schedule', () => {
  it('names a same-day range once per meridiem', () => {
    expect(eventSchedule(timed(at(9, 15), at(9, 15, 30)), NOW)?.time).toBe(
      '3:00 – 3:30 PM'
    );
    expect(eventSchedule(timed(at(9, 11), at(9, 13)), NOW)?.time).toBe(
      '11:00 AM – 1:00 PM'
    );
  });

  it('names both days of a range that crosses midnight', () => {
    expect(eventSchedule(timed(at(9, 22), at(10, 9)), NOW)?.time).toBe(
      'Oct 9, 10:00 PM – Oct 10, 9:00 AM'
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
