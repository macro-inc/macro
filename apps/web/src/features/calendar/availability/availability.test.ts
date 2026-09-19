import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { describe, expect, it } from 'vitest';
import {
  type AvailabilitySettings,
  busyIntervalsFromOccurrences,
  computeAvailability,
  DEFAULT_AVAILABILITY_SETTINGS,
  formatAvailabilityText,
  resolveAvailabilityWindow,
  sanitizeAvailabilitySettings,
} from './availability';
import { rangeTimeZoneLabel } from './zone-label';

// Mon Aug 24 2026, 10:00 local.
const MONDAY_10AM = new Date(2026, 7, 24, 10, 0);

const SETTINGS: AvailabilitySettings = {
  startTime: '09:00',
  endTime: '18:00',
  excludeWeekends: true,
};

function timedItem(options: {
  start: Date;
  end: Date;
  isCancelled?: boolean;
  status?: string;
  transparency?: string;
  selfResponseStatus?: string;
}): CalendarOccurrenceItem {
  return {
    event: {
      status: options.status ?? 'confirmed',
      transparency: options.transparency ?? 'opaque',
      attendees: options.selfResponseStatus
        ? [
            {
              email: 'self@example.com',
              isSelf: true,
              isOptional: false,
              isOrganizer: false,
              responseStatus: options.selfResponseStatus,
            },
          ]
        : [],
    },
    occurrence: {
      isCancelled: options.isCancelled ?? false,
      time: {
        kind: 'timed',
        startsAt: options.start.toISOString(),
        endsAt: options.end.toISOString(),
      },
    },
  } as unknown as CalendarOccurrenceItem;
}

function allDayItem(): CalendarOccurrenceItem {
  return {
    event: { status: 'confirmed', transparency: 'opaque', attendees: [] },
    occurrence: {
      isCancelled: false,
      time: { kind: 'allDay', startDate: '2026-08-24', endDate: '2026-08-25' },
    },
  } as unknown as CalendarOccurrenceItem;
}

function localDay(year: number, month: number, day: number) {
  return new Date(year, month, day).getTime();
}

describe('resolveAvailabilityWindow', () => {
  it('covers only today for the today range', () => {
    const window = resolveAvailabilityWindow('today', MONDAY_10AM);
    expect(window.start.getTime()).toBe(localDay(2026, 7, 24));
    expect(window.endExclusive.getTime()).toBe(localDay(2026, 7, 25));
  });

  it('runs through the coming Friday for this week', () => {
    const window = resolveAvailabilityWindow('thisWeek', MONDAY_10AM);
    // Mon Aug 24 → Fri Aug 28 inclusive.
    expect(window.endExclusive.getTime()).toBe(localDay(2026, 7, 29));
  });

  it('treats a Friday as the last day of this week', () => {
    const friday = new Date(2026, 7, 28, 10, 0);
    const window = resolveAvailabilityWindow('thisWeek', friday);
    expect(window.start.getTime()).toBe(localDay(2026, 7, 28));
    expect(window.endExclusive.getTime()).toBe(localDay(2026, 7, 29));
  });

  it('reaches the next Friday when started on a Saturday', () => {
    const saturday = new Date(2026, 7, 29, 10, 0);
    const window = resolveAvailabilityWindow('thisWeek', saturday);
    // Sat Aug 29 → Fri Sep 4 inclusive.
    expect(window.endExclusive.getTime()).toBe(localDay(2026, 8, 5));
  });

  it('runs through the same weekday for the day-based ranges', () => {
    expect(
      resolveAvailabilityWindow('next7Days', MONDAY_10AM).endExclusive.getTime()
    ).toBe(localDay(2026, 8, 1)); // through Mon Aug 31
    expect(
      resolveAvailabilityWindow(
        'next14Days',
        MONDAY_10AM
      ).endExclusive.getTime()
    ).toBe(localDay(2026, 8, 8)); // through Mon Sep 7
  });
});

describe('busyIntervalsFromOccurrences', () => {
  const start = new Date(2026, 7, 24, 11, 0);
  const end = new Date(2026, 7, 24, 12, 0);

  it('keeps confirmed timed events', () => {
    expect(busyIntervalsFromOccurrences([timedItem({ start, end })])).toEqual([
      { start: start.getTime(), end: end.getTime() },
    ]);
  });

  it('ignores events that do not block time', () => {
    const items = [
      timedItem({ start, end, isCancelled: true }),
      timedItem({ start, end, status: 'cancelled' }),
      timedItem({ start, end, transparency: 'transparent' }),
      timedItem({ start, end, selfResponseStatus: 'declined' }),
      allDayItem(),
    ];
    expect(busyIntervalsFromOccurrences(items)).toEqual([]);
  });

  it('keeps events the viewer accepted or has not answered', () => {
    const items = [
      timedItem({ start, end, selfResponseStatus: 'accepted' }),
      timedItem({ start, end, selfResponseStatus: 'needs_action' }),
    ];
    expect(busyIntervalsFromOccurrences(items)).toHaveLength(2);
  });
});

describe('computeAvailability', () => {
  it('returns the whole remaining workday when nothing is booked', () => {
    const days = computeAvailability({
      rangeKey: 'today',
      settings: SETTINGS,
      busyIntervals: [],
      now: MONDAY_10AM,
    });
    expect(days).toHaveLength(1);
    expect(days[0].slots).toEqual([
      {
        start: new Date(2026, 7, 24, 10, 0),
        end: new Date(2026, 7, 24, 18, 0),
      },
    ]);
  });

  it('rounds a mid-quarter start up to the next quarter hour', () => {
    const days = computeAvailability({
      rangeKey: 'today',
      settings: SETTINGS,
      busyIntervals: [],
      now: new Date(2026, 7, 24, 10, 7),
    });
    expect(days[0].slots[0].start).toEqual(new Date(2026, 7, 24, 10, 15));
  });

  it('splits the day around busy intervals and drops slivers', () => {
    const busy = [
      // 11:00–12:00 meeting.
      {
        start: new Date(2026, 7, 24, 11, 0).getTime(),
        end: new Date(2026, 7, 24, 12, 0).getTime(),
      },
      // Overlapping 11:30–13:00 meeting merges into the block above.
      {
        start: new Date(2026, 7, 24, 11, 30).getTime(),
        end: new Date(2026, 7, 24, 13, 0).getTime(),
      },
      // 13:10–18:00: leaves a 10-minute sliver after 13:00, dropped.
      {
        start: new Date(2026, 7, 24, 13, 10).getTime(),
        end: new Date(2026, 7, 24, 18, 0).getTime(),
      },
    ];
    const days = computeAvailability({
      rangeKey: 'today',
      settings: SETTINGS,
      busyIntervals: busy,
      now: MONDAY_10AM,
    });
    expect(days[0].slots).toEqual([
      {
        start: new Date(2026, 7, 24, 10, 0),
        end: new Date(2026, 7, 24, 11, 0),
      },
    ]);
  });

  it('skips weekends when excluded and includes them otherwise', () => {
    const excluded = computeAvailability({
      rangeKey: 'next7Days',
      settings: SETTINGS,
      busyIntervals: [],
      now: MONDAY_10AM,
    });
    // Mon–Mon inclusive minus Sat/Sun.
    expect(excluded).toHaveLength(6);
    expect(excluded.every((day) => ![0, 6].includes(day.date.getDay()))).toBe(
      true
    );

    const included = computeAvailability({
      rangeKey: 'next7Days',
      settings: { ...SETTINGS, excludeWeekends: false },
      busyIntervals: [],
      now: MONDAY_10AM,
    });
    expect(included).toHaveLength(8);
  });

  it('omits a fully booked day', () => {
    const busy = [
      {
        start: new Date(2026, 7, 24, 9, 0).getTime(),
        end: new Date(2026, 7, 24, 18, 0).getTime(),
      },
    ];
    expect(
      computeAvailability({
        rangeKey: 'today',
        settings: SETTINGS,
        busyIntervals: busy,
        now: MONDAY_10AM,
      })
    ).toEqual([]);
  });

  it('returns nothing after the workday has ended', () => {
    expect(
      computeAvailability({
        rangeKey: 'today',
        settings: SETTINGS,
        busyIntervals: [],
        now: new Date(2026, 7, 24, 18, 30),
      })
    ).toEqual([]);
  });

  it('returns nothing for an inverted workday window', () => {
    expect(
      computeAvailability({
        rangeKey: 'today',
        settings: { ...SETTINGS, startTime: '18:00', endTime: '09:00' },
        busyIntervals: [],
        now: MONDAY_10AM,
      })
    ).toEqual([]);
  });

  it('uses defaults of 9:00–18:00 excluding weekends', () => {
    expect(DEFAULT_AVAILABILITY_SETTINGS).toEqual({
      startTime: '09:00',
      endTime: '18:00',
      excludeWeekends: true,
    });
  });
});

describe('sanitizeAvailabilitySettings', () => {
  it('keeps valid persisted values', () => {
    const stored = {
      startTime: '07:30',
      endTime: '16:00',
      excludeWeekends: false,
    };
    expect(sanitizeAvailabilitySettings(stored)).toEqual(stored);
  });

  it('replaces malformed fields with defaults', () => {
    expect(
      sanitizeAvailabilitySettings({
        startTime: 'banana',
        endTime: 42,
        excludeWeekends: 'yes',
      })
    ).toEqual(DEFAULT_AVAILABILITY_SETTINGS);
    expect(sanitizeAvailabilitySettings(null)).toEqual(
      DEFAULT_AVAILABILITY_SETTINGS
    );
    expect(sanitizeAvailabilitySettings('true')).toEqual(
      DEFAULT_AVAILABILITY_SETTINGS
    );
  });

  it('fills missing fields from older builds with defaults', () => {
    expect(sanitizeAvailabilitySettings({ endTime: '17:00' })).toEqual({
      ...DEFAULT_AVAILABILITY_SETTINGS,
      endTime: '17:00',
    });
  });

  it('resets an inverted workday but keeps the weekend preference', () => {
    expect(
      sanitizeAvailabilitySettings({
        startTime: '18:00',
        endTime: '09:00',
        excludeWeekends: false,
      })
    ).toEqual({ ...DEFAULT_AVAILABILITY_SETTINGS, excludeWeekends: false });
  });
});

describe('rangeTimeZoneLabel', () => {
  // US DST ends Sun Nov 1 2026; these instants sit on either side of it.
  const beforeTransition = new Date(Date.UTC(2026, 9, 30, 14, 0));
  const afterTransition = new Date(Date.UTC(2026, 10, 3, 15, 0));
  const ZONE = 'America/New_York';

  it('keeps the specific abbreviation while the offset is constant', () => {
    const single = rangeTimeZoneLabel([beforeTransition], ZONE);
    expect(single).toBeTruthy();
    expect(
      rangeTimeZoneLabel(
        [beforeTransition, new Date(Date.UTC(2026, 9, 31, 14, 0))],
        ZONE
      )
    ).toBe(single);
  });

  it('uses a DST-agnostic label across a daylight-saving change', () => {
    const before = rangeTimeZoneLabel([beforeTransition], ZONE);
    const after = rangeTimeZoneLabel([afterTransition], ZONE);
    expect(before).not.toBe(after); // sanity: the range crosses a transition

    const label = rangeTimeZoneLabel([beforeTransition, afterTransition], ZONE);
    expect(label).toBeTruthy();
    expect(label).not.toBe(before);
    expect(label).not.toBe(after);
  });

  it('returns nothing for an empty range', () => {
    expect(rangeTimeZoneLabel([], ZONE)).toBeUndefined();
  });
});

describe('formatAvailabilityText', () => {
  it('renders a header line plus one line per day', () => {
    const days = computeAvailability({
      rangeKey: 'thisWeek',
      settings: SETTINGS,
      busyIntervals: [
        {
          start: new Date(2026, 7, 25, 9, 0).getTime(),
          end: new Date(2026, 7, 25, 12, 0).getTime(),
        },
      ],
      now: MONDAY_10AM,
    });
    const text = formatAvailabilityText(days, '12-hour', MONDAY_10AM);
    const lines = text.split('\n');

    expect(lines[0]).toMatch(/^My availability/);
    expect(lines).toHaveLength(1 + 5); // Mon–Fri
    // Every day line pairs a date label with at least one time range.
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/: .+ – .+$/);
    }
  });
});
