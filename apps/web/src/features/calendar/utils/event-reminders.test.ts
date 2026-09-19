import { describe, expect, it } from 'vitest';
import {
  REMINDER_METHOD_POPUP,
  resolveReminderOverrides,
} from './event-reminders';

const CALENDAR_DEFAULTS = [{ method: REMINDER_METHOD_POPUP, minutes: 10 }];

describe('resolveReminderOverrides', () => {
  it('resolves the calendar defaults for ordinary events', () => {
    expect(resolveReminderOverrides(undefined, CALENDAR_DEFAULTS)).toEqual(
      CALENDAR_DEFAULTS
    );
    expect(
      resolveReminderOverrides(
        { useDefault: true, overrides: [] },
        CALENDAR_DEFAULTS,
        'default'
      )
    ).toEqual(CALENDAR_DEFAULTS);
  });

  it('resolves the defaults to nothing on status-style events', () => {
    for (const eventType of [
      'working_location',
      'out_of_office',
      'focus_time',
      'birthday',
    ] as const) {
      expect(
        resolveReminderOverrides(
          { useDefault: true, overrides: [] },
          CALENDAR_DEFAULTS,
          eventType
        )
      ).toEqual([]);
    }
  });

  it('keeps explicit overrides on status-style events', () => {
    const overrides = [{ method: REMINDER_METHOD_POPUP, minutes: 5 }];
    expect(
      resolveReminderOverrides(
        { useDefault: false, overrides },
        CALENDAR_DEFAULTS,
        'working_location'
      )
    ).toEqual(overrides);
  });
});
