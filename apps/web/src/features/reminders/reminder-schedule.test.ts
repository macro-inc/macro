import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';

import {
  formatReminderWhen,
  futureDateOptions,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  reminderDefaultOptions,
  reminderDescriptionFor,
  reminderDescriptionForReference,
  reminderEditOptions,
  reminderEditPatch,
  resolveEditedDescription,
  resolveReminderDescription,
} from './reminder-schedule';

const option = (id: string, date: Date): DateOption => ({
  id,
  displayText: id,
  date,
  type: 'preset',
});

describe('futureDateOptions', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');

  it('keeps options after now and drops ones already past', () => {
    const kept = option('later', new Date('2026-07-30T09:00:00.000Z'));
    const dropped = option('earlier', new Date('2026-07-28T09:00:00.000Z'));

    expect(futureDateOptions([dropped, kept], now)).toEqual([kept]);
  });

  // The API rejects a remindAt that is not strictly in the future, so an option
  // landing exactly on "now" has to go too.
  it('drops an option exactly at now', () => {
    expect(futureDateOptions([option('now', new Date(now))], now)).toEqual([]);
  });

  it('preserves the order of the options it keeps', () => {
    const first = option('first', new Date('2026-07-30T09:00:00.000Z'));
    const second = option('second', new Date('2026-07-31T09:00:00.000Z'));
    const past = option('past', new Date('2026-07-01T09:00:00.000Z'));

    expect(futureDateOptions([first, past, second], now)).toEqual([
      first,
      second,
    ]);
  });
});

describe('onceSchedule', () => {
  it('builds a one-shot schedule at the given instant', () => {
    const date = new Date('2026-07-30T13:00:00.000Z');

    expect(onceSchedule(date)).toEqual({
      type: 'once',
      remindAt: '2026-07-30T13:00:00.000Z',
    });
  });
});

describe('reminderDefaultOptions', () => {
  // A Wednesday afternoon, so every entry is still ahead of "now".
  const wednesdayAfternoon = new Date(2026, 6, 29, 16, 37, 52, 400);

  it('offers the five reminder defaults in order', () => {
    expect(
      reminderDefaultOptions(wednesdayAfternoon).map((o) => o.displayText)
    ).toEqual([
      'In 1 hour',
      'In 2 hours',
      'Tomorrow',
      'End of week',
      'In 1 week',
    ]);
  });

  it('offsets the hour entries from now, keeping the time of day', () => {
    const [oneHour, twoHours] = reminderDefaultOptions(wednesdayAfternoon);

    expect(oneHour.date.getHours()).toBe(17);
    expect(oneHour.date.getMinutes()).toBe(37);
    expect(twoHours.date.getHours()).toBe(18);
    expect(twoHours.date.getMinutes()).toBe(37);
  });

  // Seconds dropped so the stored instant is a whole minute.
  it('rounds the hour entries down to the minute', () => {
    const hourEntries = reminderDefaultOptions(wednesdayAfternoon).slice(0, 2);

    for (const option of hourEntries) {
      expect(option.date.getSeconds()).toBe(0);
      expect(option.date.getMilliseconds()).toBe(0);
    }
  });

  it('puts the day-scale entries at the default time', () => {
    for (const option of reminderDefaultOptions(wednesdayAfternoon).slice(2)) {
      expect(option.date.getHours()).toBe(REMINDER_DEFAULT_TIME.hours);
      expect(option.date.getMinutes()).toBe(REMINDER_DEFAULT_TIME.minutes);
    }
  });

  it('dates the day-scale entries a day, a week end and a week out', () => {
    const [, , tomorrow, endOfWeek, oneWeek] =
      reminderDefaultOptions(wednesdayAfternoon);

    expect(tomorrow.date.getDate()).toBe(30);
    // Week starts Monday, so the end of this week is Sunday the 2nd.
    expect(endOfWeek.date.getMonth()).toBe(7);
    expect(endOfWeek.date.getDate()).toBe(2);
    expect(oneWeek.date.getDate()).toBe(5);
  });

  // On a Saturday the week ends tomorrow, so both land on Sunday morning.
  it('drops a preset that duplicates an earlier one', () => {
    const saturday = new Date(2026, 7, 1, 13, 0, 0);
    const options = reminderDefaultOptions(saturday);
    const labels = options.map((o) => o.displayText);

    expect(labels).toContain('Tomorrow');
    expect(labels).not.toContain('End of week');
    expect(new Set(options.map((o) => o.date.getTime())).size).toBe(
      options.length
    );
  });

  // Late on a Sunday, "End of week" has already gone by — offering it would
  // just produce a 400 from the API.
  it('drops entries that have already passed', () => {
    const sundayEvening = new Date(2026, 7, 2, 20, 0, 0);
    const labels = reminderDefaultOptions(sundayEvening).map(
      (o) => o.displayText
    );

    expect(labels).not.toContain('End of week');
    expect(labels).toContain('In 1 hour');
    expect(labels).toContain('Tomorrow');
  });

  it('describes each entry with a concrete date and time', () => {
    const [oneHour] = reminderDefaultOptions(wednesdayAfternoon);

    // Matched rather than compared: the time is rendered with the runtime
    // locale's hour cycle, so an exact string pins the test to en-US.
    expect(oneHour.secondaryText).toMatch(/^Today, \d{1,2}:\d{2}/);
  });
});

describe('reminderDescriptionFor', () => {
  const named = (type: EntityData['type'], name: string) =>
    ({ type, id: 'e1', name }) as EntityData;

  it('uses the entity name', () => {
    expect(reminderDescriptionFor(named('document', 'Q3 Contract'))).toBe(
      'Q3 Contract'
    );
  });

  it('trims the entity name', () => {
    expect(reminderDescriptionFor(named('document', '  Q3 Contract  '))).toBe(
      'Q3 Contract'
    );
  });

  // A thread's name is the placeholder "Channel thread", and its reminder
  // attaches to the parent channel — so the message text is the only thing
  // telling two reminders on the same channel apart.
  it('describes a channel thread by its message text', () => {
    const thread = {
      type: 'channel_thread',
      id: 'msg-1',
      channelId: 'chan-1',
      name: 'Channel thread',
      content: 'can we ship the migration today?',
    } as EntityData;

    expect(reminderDescriptionFor(thread)).toBe(
      'can we ship the migration today?'
    );
  });

  it('falls back to the thread placeholder when it has no text', () => {
    const thread = {
      type: 'channel_thread',
      id: 'msg-1',
      channelId: 'chan-1',
      name: 'Channel thread',
      content: '   ',
    } as EntityData;

    expect(reminderDescriptionFor(thread)).toBe('Channel thread');
  });

  // The API rejects an empty description, and plenty of entities have no name:
  // a subject-less thread, a freshly created doc.
  it('names an unnamed entity the way lists label it', () => {
    expect(reminderDescriptionFor(named('email', ''))).toBe('(No Subject)');
    expect(reminderDescriptionFor(named('document', '   '))).toBe('Untitled');
    expect(reminderDescriptionFor(named('crm_company', ''))).toBe(
      'Unknown Company'
    );
    expect(reminderDescriptionFor(named('crm_contact', ''))).toBe(
      'Unknown Contact'
    );
  });

  // Truncated rather than rejected: the description is derived from the entity,
  // so there is no input the user could shorten to get past a validation error.
  it('truncates an over-long name instead of failing', () => {
    const long = 'x'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 50);

    expect(reminderDescriptionFor(named('document', long))).toHaveLength(
      REMINDER_DESCRIPTION_MAX_LENGTH
    );
  });

  it('leaves a name exactly at the limit alone', () => {
    const atLimit = 'x'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH);

    expect(reminderDescriptionFor(named('document', atLimit))).toBe(atLimit);
  });

  // The service counts characters, not bytes, and truncating mid-surrogate
  // would corrupt the emoji rather than drop it.
  it('truncates by character, not by code unit', () => {
    const emoji = '🔔'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 10);
    const result = reminderDescriptionFor(named('document', emoji));

    expect([...result]).toHaveLength(REMINDER_DESCRIPTION_MAX_LENGTH);
    expect(result.endsWith('🔔')).toBe(true);
  });
});

describe('resolveReminderDescription', () => {
  const doc = (name: string) =>
    ({ type: 'document', id: 'e1', name }) as EntityData;

  it('uses what the user typed', () => {
    expect(
      resolveReminderDescription(
        'Chase the countersignature',
        doc('Q3 Contract')
      )
    ).toBe('Chase the countersignature');
  });

  it('trims what the user typed', () => {
    expect(resolveReminderDescription('  Chase it  ', doc('Q3 Contract'))).toBe(
      'Chase it'
    );
  });

  // The step is optional and the API rejects an empty description, so skipping
  // it has to land on the entity-derived name rather than send nothing.
  it('falls back to the entity name when the field is skipped', () => {
    expect(resolveReminderDescription('', doc('Q3 Contract'))).toBe(
      'Q3 Contract'
    );
  });

  it('treats whitespace-only input as skipped', () => {
    expect(resolveReminderDescription('   \n\t ', doc('Q3 Contract'))).toBe(
      'Q3 Contract'
    );
  });

  // Skipping on an unnamed entity still has to produce something valid.
  it('falls back through to the untitled label', () => {
    expect(resolveReminderDescription('', doc('  '))).toBe('Untitled');
  });

  // The input's maxLength counts code units, so an emoji-heavy paste can still
  // arrive over the service's character limit.
  it('truncates over-long input by character', () => {
    const long = '🔔'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 10);
    const result = resolveReminderDescription(long, doc('Q3 Contract'));

    expect([...result]).toHaveLength(REMINDER_DESCRIPTION_MAX_LENGTH);
    expect(result.endsWith('🔔')).toBe(true);
  });

  it('leaves input exactly at the limit alone', () => {
    const atLimit = 'x'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH);

    expect(resolveReminderDescription(atLimit, doc('Q3 Contract'))).toBe(
      atLimit
    );
  });
});

describe('REMINDER_DEFAULT_TIME', () => {
  // Bare dates come from presets that land on endOfDay; a reminder at 11:59 PM
  // is easy to miss, so this is deliberately a morning.
  it('is 9am', () => {
    expect(REMINDER_DEFAULT_TIME).toEqual({ hours: 9, minutes: 0 });
  });
});

describe('formatReminderWhen', () => {
  // Fixed instants rather than the wall clock, and the assertions compare
  // against `toLocaleString` output rather than a hardcoded string, so the
  // test states what is included and stays put across locales and timezones.
  const now = new Date('2026-08-07T10:00:00.000Z').getTime();
  const timeOnly = { hour: 'numeric', minute: '2-digit' } as const;
  const withDate = { month: 'short', day: 'numeric', ...timeOnly } as const;

  it('omits the date three hours out', () => {
    const date = new Date(now + 3 * 60 * 60 * 1000);
    expect(formatReminderWhen(date, now)).toBe(
      date.toLocaleString(undefined, timeOnly)
    );
  });

  it('omits the date just under a day out', () => {
    const date = new Date(now + 24 * 60 * 60 * 1000 - 1);
    expect(formatReminderWhen(date, now)).toBe(
      date.toLocaleString(undefined, timeOnly)
    );
  });

  it('includes the date at exactly a day out', () => {
    const date = new Date(now + 24 * 60 * 60 * 1000);
    expect(formatReminderWhen(date, now)).toBe(
      date.toLocaleString(undefined, withDate)
    );
  });

  it('includes the date a week out', () => {
    const date = new Date(now + 7 * 24 * 60 * 60 * 1000);
    expect(formatReminderWhen(date, now)).toBe(
      date.toLocaleString(undefined, withDate)
    );
  });

  // The composer rejects past times before this runs, but a date that slipped
  // past while the dialog sat open should still read as a time, not crash or
  // sprout a date.
  it('omits the date for an instant already past', () => {
    const date = new Date(now - 60 * 1000);
    expect(formatReminderWhen(date, now)).toBe(
      date.toLocaleString(undefined, timeOnly)
    );
  });
});

describe('reminderEditOptions', () => {
  // A Wednesday afternoon, so every default entry is still ahead of "now".
  const wednesdayAfternoon = new Date(2026, 6, 29, 16, 37, 52, 400);
  const current = new Date(2026, 7, 3, 9, 0, 0, 0);

  it('leads with keeping the current time, then the defaults', () => {
    expect(
      reminderEditOptions(current, wednesdayAfternoon).map((o) => o.displayText)
    ).toEqual([
      'Keep current time',
      'In 1 hour',
      'In 2 hours',
      'Tomorrow',
      'End of week',
      'In 1 week',
    ]);
  });

  it('keeps the exact instant the reminder already has', () => {
    const [keep] = reminderEditOptions(current, wednesdayAfternoon);

    expect(keep.date.getTime()).toBe(current.getTime());
  });

  // Both would submit the same instant, so offering them separately would read
  // as two different choices with one outcome.
  it('drops a default that lands on the current time', () => {
    const tomorrowMorning = new Date(2026, 6, 30, 9, 0, 0, 0);
    const options = reminderEditOptions(tomorrowMorning, wednesdayAfternoon);

    expect(options.map((o) => o.displayText)).not.toContain('Tomorrow');
    expect(options[0].displayText).toBe('Keep current time');
  });

  // An overdue reminder still has to be renamable, and keeping its time sends
  // no schedule at all — so the future filter must not remove the keep option.
  it('offers keeping a time that has already passed', () => {
    const overdue = new Date(2026, 6, 20, 9, 0, 0, 0);
    const [keep] = reminderEditOptions(overdue, wednesdayAfternoon);

    expect(keep.displayText).toBe('Keep current time');
    expect(keep.date.getTime()).toBe(overdue.getTime());
  });
});

describe('reminderEditPatch', () => {
  const remindAt = new Date('2026-08-09T09:00:00.000Z');
  const original = {
    description: 'Chase the contract',
    remindAt,
    completed: false,
  };

  // An empty patch is rejected by the API as having no fields to update, so
  // "nothing changed" has to be distinguishable from "patch these fields".
  it('returns undefined when neither answer moved', () => {
    expect(
      reminderEditPatch(original, {
        description: 'Chase the contract',
        remindAt: new Date(remindAt),
      })
    ).toBeUndefined();
  });

  it('sends only the description when the time is kept', () => {
    expect(
      reminderEditPatch(original, {
        description: 'Chase the signed contract',
        remindAt: new Date(remindAt),
      })
    ).toEqual({ description: 'Chase the signed contract' });
  });

  it('sends only the schedule when the description is kept', () => {
    const next = new Date('2026-08-10T09:00:00.000Z');

    expect(
      reminderEditPatch(original, {
        description: 'Chase the contract',
        remindAt: next,
      })
    ).toEqual({ schedule: { type: 'once', remindAt: next.toISOString() } });
  });

  it('sends both when both moved', () => {
    const next = new Date('2026-08-10T09:00:00.000Z');

    expect(
      reminderEditPatch(original, { description: 'Follow up', remindAt: next })
    ).toEqual({
      description: 'Follow up',
      schedule: { type: 'once', remindAt: next.toISOString() },
    });
  });

  it('trims the description before comparing it', () => {
    expect(
      reminderEditPatch(original, {
        description: '  Chase the contract  ',
        remindAt: new Date(remindAt),
      })
    ).toBeUndefined();
  });

  // The editor blocks a blank description at the step before this, but a blank
  // must never be sent — the API rejects it, and it is a deletion, not an edit.
  it('ignores a blank description', () => {
    expect(
      reminderEditPatch(original, {
        description: '   ',
        remindAt: new Date(remindAt),
      })
    ).toBeUndefined();
  });

  it('caps an over-long description at the API limit', () => {
    const patch = reminderEditPatch(original, {
      description: 'a'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 50),
      remindAt: new Date(remindAt),
    });

    expect(patch?.description).toHaveLength(REMINDER_DESCRIPTION_MAX_LENGTH);
  });

  // The dispatcher skips completed reminders, so a new time on one that was
  // marked done would silently never arrive unless the flag comes off with it.
  it('clears the done flag when a completed reminder is rescheduled', () => {
    const next = new Date('2026-08-10T09:00:00.000Z');

    expect(
      reminderEditPatch(
        { ...original, completed: true },
        { description: 'Chase the contract', remindAt: next }
      )
    ).toEqual({
      schedule: { type: 'once', remindAt: next.toISOString() },
      completed: false,
    });
  });

  // Renaming a done reminder is not a request for it to fire again.
  it('leaves the done flag alone when only the description changes', () => {
    expect(
      reminderEditPatch(
        { ...original, completed: true },
        { description: 'Follow up', remindAt: new Date(remindAt) }
      )
    ).toEqual({ description: 'Follow up' });
  });
});

describe('reminderDescriptionForReference', () => {
  it('uses the resolved reference name', () => {
    expect(reminderDescriptionForReference('Q3 Contract', 'document')).toBe(
      'Q3 Contract'
    );
  });

  it('trims the reference name', () => {
    expect(reminderDescriptionForReference('  Q3 Contract  ', 'document')).toBe(
      'Q3 Contract'
    );
  });

  // Same fallbacks as reminderDescriptionFor, so blanking an edit lands on the
  // name creating the reminder would have chosen.
  it('names an unnamed reference the way lists label it', () => {
    expect(reminderDescriptionForReference('', 'email')).toBe('(No Subject)');
    expect(reminderDescriptionForReference('   ', 'document')).toBe('Untitled');
    expect(reminderDescriptionForReference(undefined, 'crm_company')).toBe(
      'Unknown Company'
    );
    expect(reminderDescriptionForReference(undefined, 'crm_contact')).toBe(
      'Unknown Contact'
    );
  });

  it('truncates an over-long reference name instead of failing', () => {
    const long = 'x'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 50);

    expect(reminderDescriptionForReference(long, 'document')).toHaveLength(
      REMINDER_DESCRIPTION_MAX_LENGTH
    );
  });
});

describe('resolveEditedDescription', () => {
  it('uses what was typed', () => {
    expect(
      resolveEditedDescription('Follow up', 'Chase the contract', 'Q3 Contract')
    ).toBe('Follow up');
  });

  it('trims what was typed', () => {
    expect(
      resolveEditedDescription('  Follow up  ', 'Chase the contract')
    ).toBe('Follow up');
  });

  // Blanking the field means the same thing it means when creating: name this
  // after whatever it is about.
  it('falls back to the reference name when left blank', () => {
    expect(
      resolveEditedDescription('', 'Chase the contract', 'Q3 Contract')
    ).toBe('Q3 Contract');
  });

  it('treats a whitespace-only description as blank', () => {
    expect(
      resolveEditedDescription('   ', 'Chase the contract', 'Q3 Contract')
    ).toBe('Q3 Contract');
  });

  // A standalone reminder has nothing to name itself after, and a reference
  // whose name did not resolve must not rename it to a placeholder.
  it('keeps the current description when there is nothing to fall back to', () => {
    expect(resolveEditedDescription('', 'Chase the contract')).toBe(
      'Chase the contract'
    );
    expect(
      resolveEditedDescription('  ', 'Chase the contract', undefined)
    ).toBe('Chase the contract');
  });

  it('caps an over-long typed description at the API limit', () => {
    const long = 'y'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 50);

    expect(resolveEditedDescription(long, 'Chase the contract')).toHaveLength(
      REMINDER_DESCRIPTION_MAX_LENGTH
    );
  });
});
