import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Property } from '../types';

const calendarPreferences = vi.hoisted(() => ({ timeFormat: '12-hour' }));
vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [calendarPreferences],
}));

import {
  formatStartDue,
  formatStartDueCompact,
  pickDay,
  pickTime,
  pickTimedDay,
  rescheduledStartDue,
  startDueDays,
  startDueLength,
  startDueOf,
  withoutTimes,
  withTimes,
} from './start-due';

const NOW = new Date(2026, 10, 20);

describe('formatStartDue', () => {
  it('reads as one date when the start and due date share a day', () => {
    expect(
      formatStartDue(
        { start: new Date(2026, 10, 25), due: new Date(2026, 10, 25, 23, 59) },
        NOW
      )
    ).toBe('Nov 25');
    expect(
      formatStartDue(
        { start: new Date(2027, 0, 4), due: new Date(2027, 0, 4) },
        NOW
      )
    ).toBe('Jan 4, 2027');
  });

  it('reads as a range within the current year', () => {
    expect(
      formatStartDue(
        { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
        NOW
      )
    ).toBe('Nov 23 → Nov 27');
  });

  it('names the year once when it is not the current one', () => {
    expect(
      formatStartDue(
        { start: new Date(2027, 0, 4), due: new Date(2027, 0, 8) },
        NOW
      )
    ).toBe('Jan 4 → Jan 8, 2027');
  });

  it('names both years when the range crosses one', () => {
    expect(
      formatStartDue(
        { start: new Date(2026, 11, 28), due: new Date(2027, 0, 3) },
        NOW
      )
    ).toBe('Dec 28, 2026 → Jan 3, 2027');
  });

  it('leaves the end open without a due date', () => {
    expect(
      formatStartDue({ start: new Date(2026, 10, 23), due: null }, NOW)
    ).toBe('Nov 23 →');
  });

  it('has no range without a start', () => {
    expect(
      formatStartDue({ start: null, due: new Date(2026, 10, 27) }, NOW)
    ).toBeUndefined();
  });
});

describe('startDueDays', () => {
  it('counts both ends', () => {
    expect(startDueDays(new Date(2026, 10, 23), new Date(2026, 10, 27))).toBe(
      5
    );
    expect(startDueDays(new Date(2026, 10, 23), new Date(2026, 10, 23))).toBe(
      1
    );
  });

  it('counts calendar days across a daylight saving change', () => {
    expect(startDueDays(new Date(2026, 2, 7), new Date(2026, 2, 9))).toBe(3);
  });
});

describe('pickDay', () => {
  const range = { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) };

  it('sets the field that is picked', () => {
    expect(pickDay(range, 'due', new Date(2026, 10, 30))).toEqual({
      dates: { start: range.start, due: new Date(2026, 10, 30) },
      changed: ['due'],
    });
    expect(pickDay(range, 'start', new Date(2026, 10, 25))).toEqual({
      dates: { start: new Date(2026, 10, 25), due: range.due },
      changed: ['start'],
    });
  });

  it('makes a due day before the start the new start', () => {
    expect(pickDay(range, 'due', new Date(2026, 10, 20))).toEqual({
      dates: { start: new Date(2026, 10, 20), due: range.due },
      changed: ['start'],
    });
  });

  it('moves the due date with a start day picked after it, keeping the length', () => {
    expect(pickDay(range, 'start', new Date(2026, 11, 1))).toEqual({
      dates: { start: new Date(2026, 11, 1), due: new Date(2026, 11, 5) },
      changed: ['start', 'due'],
    });
    expect(
      pickDay({ start: null, due: range.due }, 'start', new Date(2026, 11, 1))
    ).toEqual({
      dates: { start: new Date(2026, 11, 1), due: new Date(2026, 11, 1) },
      changed: ['start', 'due'],
    });
  });

  it('never moves the due date for a start on or before it', () => {
    expect(pickDay(range, 'start', range.due)).toEqual({
      dates: { start: range.due, due: range.due },
      changed: ['start'],
    });
  });

  it('lets either end be set alone', () => {
    expect(pickDay({ start: null, due: null }, 'start', range.start)).toEqual({
      dates: { start: range.start, due: null },
      changed: ['start'],
    });
    expect(pickDay({ start: null, due: null }, 'due', range.due)).toEqual({
      dates: { start: null, due: range.due },
      changed: ['due'],
    });
  });
});

const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 10, day, hours, minutes);

describe('dates with times', () => {
  it('read as one block on a day, a range across days, and a lone end', () => {
    expect(
      formatStartDue({ start: at(26, 14), due: at(26, 16), timed: true }, NOW)
    ).toBe('Nov 26, 2:00 – 4:00 PM');
    expect(
      formatStartDue({ start: at(26, 14), due: at(28, 16), timed: true }, NOW)
    ).toBe('Nov 26, 2:00 PM → Nov 28, 4:00 PM');
    expect(
      formatStartDue({ start: at(26, 14), due: null, timed: true }, NOW)
    ).toBe('Nov 26, 2:00 PM →');
    expect(
      formatStartDue({ start: null, due: at(26, 16, 30), timed: true }, NOW)
    ).toBe('Nov 26, 4:30 PM');
  });

  it('read an end saved as a whole day without a time', () => {
    expect(
      formatStartDue(
        { start: at(20, 19), due: at(30, 15), timed: true, wholeDay: 'start' },
        NOW
      )
    ).toBe('Nov 20 → Nov 30, 3:00 PM');
    expect(
      formatStartDue(
        { start: at(30, 0), due: at(30, 15), timed: true, wholeDay: 'start' },
        NOW
      )
    ).toBe('Nov 30, 3:00 PM');
    expect(
      formatStartDue(
        { start: at(30, 14), due: at(30, 0), timed: true, wholeDay: 'due' },
        NOW
      )
    ).toBe('Nov 30, 2:00 PM → Nov 30');
  });

  it('mark the end without a time when only one end has one', () => {
    const date = (value: Date, hasTime?: boolean) =>
      ({
        valueType: 'DATE',
        value,
        ...(hasTime ? { hasTime } : {}),
      }) as Property;
    expect(startDueOf(date(at(20, 19)), date(at(30, 15), true))).toEqual({
      start: at(20, 19),
      due: at(30, 15),
      timed: true,
      wholeDay: 'start',
    });
    expect(startDueOf(undefined, date(at(30, 15), true))).toEqual({
      start: null,
      due: at(30, 15),
      timed: true,
    });
    expect(startDueOf(date(at(26, 14), true), date(at(30, 15), true))).toEqual({
      start: at(26, 14),
      due: at(30, 15),
      timed: true,
    });
  });

  it('follow the calendar clock setting', () => {
    calendarPreferences.timeFormat = '24-hour';
    try {
      expect(
        formatStartDue({ start: null, due: at(26, 16), timed: true }, NOW)
      ).toBe('Nov 26, 16:00');
    } finally {
      calendarPreferences.timeFormat = '12-hour';
    }
  });

  it('keep a due date alone without times to its own text', () => {
    expect(
      formatStartDue({ start: null, due: at(26, 0) }, NOW)
    ).toBeUndefined();
  });

  it('measure a length in hours within a day and in days across days', () => {
    expect(
      startDueLength({ start: at(26, 14), due: at(26, 16, 30), timed: true })
    ).toBe('2h 30min');
    expect(
      startDueLength({ start: at(26, 14), due: at(28, 9), timed: true })
    ).toBe('3 days');
    expect(startDueLength({ start: at(23, 0), due: at(27, 0) })).toBe('5 days');
  });

  it('get the next full hour and an hour after it when times are added', () => {
    expect(
      withTimes({ start: at(23, 0), due: at(27, 0) }, at(20, 9, 41))
    ).toEqual({ start: at(23, 10), due: at(27, 11), timed: true });
    expect(withTimes({ start: null, due: at(27, 0) }, at(20, 9, 41))).toEqual({
      start: null,
      due: at(27, 10),
      timed: true,
    });
    expect(withTimes({ start: null, due: null }, at(20, 9, 41))).toEqual({
      start: null,
      due: at(20, 10),
      timed: true,
    });
  });

  it('go back to whole days when times are removed', () => {
    expect(
      withoutTimes({ start: at(26, 14), due: at(27, 16), timed: true })
    ).toEqual({ start: at(26, 0), due: at(27, 0) });
  });

  it('move the due date with a new start time, keeping the length', () => {
    expect(
      pickTime(
        { start: at(26, 14), due: at(26, 16), timed: true },
        'start',
        at(26, 0),
        15 * 60
      )
    ).toEqual({
      dates: { start: at(26, 15), due: at(26, 17), timed: true },
      changed: ['start', 'due'],
    });
  });

  it('move the start back to a due time picked before it', () => {
    expect(
      pickTime(
        { start: at(26, 14), due: at(26, 16), timed: true },
        'due',
        at(26, 0),
        13 * 60
      )
    ).toEqual({
      dates: { start: at(26, 13), due: at(26, 13), timed: true },
      changed: ['start', 'due'],
    });
    expect(
      pickTime(
        { start: at(26, 14), due: at(26, 16), timed: true },
        'due',
        at(27, 0),
        9 * 60
      )
    ).toEqual({
      dates: { start: at(26, 14), due: at(27, 9), timed: true },
      changed: ['due'],
    });
  });

  it('move the due date to a start time picked past it when there is no length to keep', () => {
    expect(
      pickTime(
        { start: null, due: at(26, 2), timed: true },
        'start',
        at(26, 0),
        13 * 60
      )
    ).toEqual({
      dates: { start: at(26, 13), due: at(26, 13), timed: true },
      changed: ['start', 'due'],
    });
    expect(
      pickTime(
        { start: at(26, 16), due: at(26, 14), timed: true },
        'start',
        at(26, 0),
        15 * 60
      )
    ).toEqual({
      dates: { start: at(26, 15), due: at(26, 15), timed: true },
      changed: ['start', 'due'],
    });
  });

  it('leave the due date for a start time before it when there is no length to keep', () => {
    expect(
      pickTime(
        { start: null, due: at(26, 16), timed: true },
        'start',
        at(26, 0),
        13 * 60
      )
    ).toEqual({
      dates: { start: at(26, 13), due: at(26, 16), timed: true },
      changed: ['start'],
    });
    expect(
      pickTime(
        { start: at(26, 16), due: at(26, 14), timed: true },
        'start',
        at(26, 0),
        9 * 60
      )
    ).toEqual({
      dates: { start: at(26, 9), due: at(26, 14), timed: true },
      changed: ['start'],
    });
  });

  it('leave a timed due date for a start time on a whole-day start, unless the start passes it', () => {
    const dates = {
      start: at(24, 0),
      due: at(27, 20),
      timed: true,
      wholeDay: 'start' as const,
    };
    expect(pickTime(dates, 'start', at(24, 0), 9 * 60)).toEqual({
      dates: { ...dates, start: at(24, 9) },
      changed: ['start'],
    });
    const sameDay = { ...dates, start: at(27, 0) };
    expect(pickTime(sameDay, 'start', at(27, 0), 9 * 60)).toEqual({
      dates: { ...sameDay, start: at(27, 9) },
      changed: ['start'],
    });
    expect(pickTime(sameDay, 'start', at(27, 0), 21 * 60)).toEqual({
      dates: { ...sameDay, start: at(27, 21), due: at(27, 21) },
      changed: ['start', 'due'],
    });
  });

  it('keep a whole-day due date a whole day until a start time passes it', () => {
    const endOfDay = new Date(2026, 10, 26, 23, 59, 59, 999);
    const dates = {
      start: at(26, 9),
      due: endOfDay,
      timed: true,
      wholeDay: 'due' as const,
    };
    expect(pickTime(dates, 'start', at(26, 0), 14 * 60)).toEqual({
      dates: { ...dates, start: at(26, 14) },
      changed: ['start'],
    });
    const midnight = { ...dates, start: at(26, 0), due: at(26, 0) };
    expect(pickTime(midnight, 'start', at(26, 0), 14 * 60)).toEqual({
      dates: { ...midnight, start: at(26, 14), due: at(26, 14) },
      changed: ['start', 'due'],
    });
  });

  it('keep each end its time when a day is picked', () => {
    expect(
      pickTimedDay(
        { start: at(26, 14), due: at(26, 16), timed: true },
        'due',
        at(28, 0)
      )
    ).toEqual({
      dates: { start: at(26, 14), due: at(28, 16), timed: true },
      changed: ['due'],
    });
    expect(
      pickTimedDay(
        { start: at(26, 14), due: at(27, 16), timed: true },
        'due',
        at(24, 0)
      )
    ).toEqual({
      dates: { start: at(24, 14), due: at(27, 16), timed: true },
      changed: ['start'],
    });
  });
});

describe('formatStartDueCompact', () => {
  it('writes times compactly, as on a calendar event', () => {
    expect(
      formatStartDueCompact(
        { start: at(26, 14), due: at(26, 16), timed: true },
        NOW
      )
    ).toBe('Nov 26, 2–4pm');
    expect(
      formatStartDueCompact(
        { start: at(26, 14), due: at(28, 16, 30), timed: true },
        NOW
      )
    ).toBe('Nov 26 → Nov 28');
    expect(
      formatStartDueCompact({ start: null, due: at(26, 9), timed: true }, NOW)
    ).toBe('Nov 26, 9am');
  });

  it('writes one time when the start and due date are the same moment', () => {
    expect(
      formatStartDueCompact(
        { start: at(26, 13), due: at(26, 13), timed: true },
        NOW
      )
    ).toBe('Nov 26, 1pm');
  });

  it('reads an end saved as a whole day without a time', () => {
    expect(
      formatStartDueCompact(
        { start: at(26, 0), due: at(26, 15), timed: true, wholeDay: 'start' },
        NOW
      )
    ).toBe('Nov 26, 3pm');
    expect(
      formatStartDueCompact(
        { start: at(26, 14), due: at(26, 0), timed: true, wholeDay: 'due' },
        NOW
      )
    ).toBe('Nov 26, 2pm → Nov 26');
  });

  it('reads whole days as the full form does', () => {
    expect(
      formatStartDueCompact({ start: at(23, 0), due: at(27, 0) }, NOW)
    ).toBe('Nov 23 → Nov 27');
  });
});

describe('dates with times, at the edges', () => {
  it('rolls a first due time over to tomorrow late in the evening', () => {
    expect(withTimes({ start: null, due: null }, at(20, 23, 41))).toEqual({
      start: null,
      due: at(21, 0),
      timed: true,
    });
  });

  it('moves the start with a due day picked back onto its day before it', () => {
    expect(
      pickTimedDay(
        { start: at(26, 14), due: at(27, 9), timed: true },
        'due',
        at(26, 0)
      )
    ).toEqual({
      dates: { start: at(26, 9), due: at(26, 9), timed: true },
      changed: ['start', 'due'],
    });
  });

  describe('on a daylight saving day', () => {
    const systemTimeZone = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/New_York';
    });
    afterAll(() => {
      process.env.TZ = systemTimeZone;
    });

    it('keeps the clock time picked and the clock time carried to another day', () => {
      expect(new Date(2026, 2, 9).getTimezoneOffset()).toBe(240);
      const springForward = new Date(2026, 2, 8);
      expect(
        pickTime(
          { start: null, due: null, timed: true },
          'due',
          springForward,
          14 * 60
        ).dates.due?.getHours()
      ).toBe(14);
      expect(
        withTimes(
          { start: null, due: springForward },
          new Date(2026, 2, 8, 13, 41)
        ).due?.getHours()
      ).toBe(14);
      const moved = pickTimedDay(
        { start: null, due: new Date(2026, 10, 1, 14), timed: true },
        'due',
        new Date(2026, 10, 2)
      ).dates.due;
      expect([moved?.getDate(), moved?.getHours()]).toEqual([2, 14]);
    });
  });
});

describe('pickTimedDay past the due date', () => {
  it('moves the due date with a start day picked after it, keeping the length and both times', () => {
    expect(
      pickTimedDay(
        {
          start: new Date(2026, 10, 26, 14),
          due: new Date(2026, 10, 27, 16),
          timed: true,
        },
        'start',
        new Date(2026, 10, 30)
      )
    ).toEqual({
      dates: {
        start: new Date(2026, 10, 30, 14),
        due: new Date(2026, 11, 1, 16),
        timed: true,
      },
      changed: ['start', 'due'],
    });
  });
});

describe('rescheduledStartDue', () => {
  it('saves only the end a whole-day edge drag moved, compared by day', () => {
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(27, 23, 59) },
        { start: at(23, 0), end: at(29, 0), allDay: true }
      )
    ).toEqual([{ field: 'due', value: at(29, 0), hasTime: false }]);
  });

  it('saves the due date first when a moved bar starts after the saved due date', () => {
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(25, 0) },
        { start: at(26, 0), end: at(28, 0), allDay: true }
      )
    ).toEqual([
      { field: 'due', value: at(28, 0), hasTime: false },
      { field: 'start', value: at(26, 0), hasTime: false },
    ]);
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(27, 0) },
        { start: at(22, 0), end: at(26, 0), allDay: true }
      ).map((end) => end.field)
    ).toEqual(['start', 'due']);
  });

  it('keeps the times of a timed bar and compares them by moment', () => {
    expect(
      rescheduledStartDue(
        { start: at(26, 14), due: at(26, 16) },
        { start: at(26, 15), end: at(26, 16), allDay: false }
      )
    ).toEqual([{ field: 'start', value: at(26, 15), hasTime: true }]);
  });

  it('keeps an end saved as a whole day whole on a timed bar', () => {
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(27, 15), wholeDay: 'start' },
        { start: at(24, 0), end: at(28, 15), allDay: false }
      )
    ).toEqual([
      { field: 'start', value: at(24, 0), hasTime: false },
      { field: 'due', value: at(28, 15), hasTime: true },
    ]);
  });

  it('compares an end saved as a whole day by its day on a timed bar, and saves it at the start of the day', () => {
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(27, 15), wholeDay: 'start' },
        { start: at(23, 1), end: at(27, 15), allDay: false }
      )
    ).toEqual([]);
    expect(
      rescheduledStartDue(
        { start: at(23, 0), due: at(27, 15), wholeDay: 'start' },
        { start: at(24, 1), end: at(27, 15), allDay: false }
      )
    ).toEqual([{ field: 'start', value: at(24, 0), hasTime: false }]);
  });

  it('gives a task drawn from its created date a start only when the start moved', () => {
    const created = new Date(2026, 10, 20, 9, 12);
    expect(
      rescheduledStartDue(
        { start: created, due: at(27, 0) },
        { start: at(20, 0), end: at(28, 0), allDay: true }
      )
    ).toEqual([{ field: 'due', value: at(28, 0), hasTime: false }]);
    expect(
      rescheduledStartDue(
        { start: created, due: at(27, 0) },
        { start: at(21, 0), end: at(28, 0), allDay: true }
      ).map((end) => end.field)
    ).toEqual(['start', 'due']);
  });
});
