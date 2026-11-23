import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  startDueDays,
  startDueLength,
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
      changed: 'due',
    });
    expect(pickDay(range, 'start', new Date(2026, 10, 25))).toEqual({
      dates: { start: new Date(2026, 10, 25), due: range.due },
      changed: 'start',
    });
  });

  it('makes a due day before the start the new start', () => {
    expect(pickDay(range, 'due', new Date(2026, 10, 20))).toEqual({
      dates: { start: new Date(2026, 10, 20), due: range.due },
      changed: 'start',
    });
  });

  it('makes a start day after the due date the new due date', () => {
    expect(pickDay(range, 'start', new Date(2026, 11, 1))).toEqual({
      dates: { start: range.start, due: new Date(2026, 11, 1) },
      changed: 'due',
    });
  });

  it('lets either end be set alone', () => {
    expect(pickDay({ start: null, due: null }, 'start', range.start)).toEqual({
      dates: { start: range.start, due: null },
      changed: 'start',
    });
    expect(pickDay({ start: null, due: null }, 'due', range.due)).toEqual({
      dates: { start: null, due: range.due },
      changed: 'due',
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
    ).toBe('Nov 26, 2pm → Nov 28, 4:30pm');
    expect(
      formatStartDueCompact({ start: null, due: at(26, 9), timed: true }, NOW)
    ).toBe('Nov 26, 9am');
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
