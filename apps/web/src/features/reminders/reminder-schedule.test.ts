import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';

import {
  defaultRepeatParts,
  describeReminderSchedule,
  futureDateOptions,
  isRecurring,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  recurringSchedule,
  reminderDefaultOptions,
  reminderDescriptionFor,
  reminderDescriptionForReference,
  reminderEditOptions,
  reminderEditPatch,
  repeatPartsFromDate,
  repeatPartsFromSchedule,
  resolveEditedDescription,
  resolveReminderDescription,
  resolveStandaloneDescription,
  sameSchedule,
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

  it('offers the four reminder defaults in order', () => {
    expect(
      reminderDefaultOptions(wednesdayAfternoon).map((o) => o.displayText)
    ).toEqual(['In 1 hour', 'In 2 hours', 'Tomorrow', 'In 1 week']);
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

  it('dates the day-scale entries a day and a week out', () => {
    const [, , tomorrow, oneWeek] = reminderDefaultOptions(wednesdayAfternoon);

    expect(tomorrow.date.getDate()).toBe(30);
    expect(oneWeek.date.getDate()).toBe(5);
  });

  // No two presets can currently land on the same instant, so this guards the
  // list as it grows rather than a case it has today.
  it('never offers the same instant under two labels', () => {
    for (const now of [
      new Date(2026, 7, 1, 13, 0, 0),
      new Date(2026, 7, 2, 20, 0, 0),
      wednesdayAfternoon,
    ]) {
      const options = reminderDefaultOptions(now);
      expect(new Set(options.map((o) => o.date.getTime())).size).toBe(
        options.length
      );
    }
  });

  // The API rejects a firing that is not strictly in the future, and every
  // preset is now offset forward from `now` — so this holds whenever it runs.
  it('only ever offers times in the future', () => {
    for (const now of [new Date(2026, 7, 2, 23, 59, 0), wednesdayAfternoon]) {
      for (const option of reminderDefaultOptions(now)) {
        expect(option.date.getTime()).toBeGreaterThan(now.getTime());
      }
    }
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

describe('resolveStandaloneDescription', () => {
  it('uses what the user typed', () => {
    expect(resolveStandaloneDescription('Book a flight')).toBe('Book a flight');
  });

  it('trims what the user typed', () => {
    expect(resolveStandaloneDescription('  Book a flight  ')).toBe(
      'Book a flight'
    );
  });

  // There is no entity to name this reminder after, so an empty field has no
  // answer at all — which is also how the composer knows it cannot advance.
  it('has no answer for an empty field', () => {
    expect(resolveStandaloneDescription('')).toBeUndefined();
  });

  it('treats whitespace-only input as empty', () => {
    expect(resolveStandaloneDescription('   \n\t ')).toBeUndefined();
  });

  it('truncates over-long input by character', () => {
    const long = '🔔'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 10);
    const result = resolveStandaloneDescription(long);

    expect([...(result ?? '')]).toHaveLength(REMINDER_DESCRIPTION_MAX_LENGTH);
  });
});

describe('REMINDER_DEFAULT_TIME', () => {
  // Bare dates come from presets that land on endOfDay; a reminder at 11:59 PM
  // is easy to miss, so this is deliberately a morning.
  it('is 9am', () => {
    expect(REMINDER_DEFAULT_TIME).toEqual({ hours: 9, minutes: 0 });
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
    schedule: onceSchedule(remindAt),
    completed: false,
  };

  // An empty patch is rejected by the API as having no fields to update, so
  // "nothing changed" has to be distinguishable from "patch these fields".
  it('returns undefined when neither answer moved', () => {
    expect(
      reminderEditPatch(original, {
        description: 'Chase the contract',
        schedule: onceSchedule(new Date(remindAt)),
      })
    ).toBeUndefined();
  });

  it('sends only the description when the time is kept', () => {
    expect(
      reminderEditPatch(original, {
        description: 'Chase the signed contract',
        schedule: onceSchedule(new Date(remindAt)),
      })
    ).toEqual({ description: 'Chase the signed contract' });
  });

  it('sends only the schedule when the description is kept', () => {
    const next = new Date('2026-08-10T09:00:00.000Z');

    expect(
      reminderEditPatch(original, {
        description: 'Chase the contract',
        schedule: onceSchedule(next),
      })
    ).toEqual({ schedule: { type: 'once', remindAt: next.toISOString() } });
  });

  it('sends both when both moved', () => {
    const next = new Date('2026-08-10T09:00:00.000Z');

    expect(
      reminderEditPatch(original, {
        description: 'Follow up',
        schedule: onceSchedule(next),
      })
    ).toEqual({
      description: 'Follow up',
      schedule: { type: 'once', remindAt: next.toISOString() },
    });
  });

  it('trims the description before comparing it', () => {
    expect(
      reminderEditPatch(original, {
        description: '  Chase the contract  ',
        schedule: onceSchedule(new Date(remindAt)),
      })
    ).toBeUndefined();
  });

  // The editor blocks a blank description at the step before this, but a blank
  // must never be sent — the API rejects it, and it is a deletion, not an edit.
  it('ignores a blank description', () => {
    expect(
      reminderEditPatch(original, {
        description: '   ',
        schedule: onceSchedule(new Date(remindAt)),
      })
    ).toBeUndefined();
  });

  it('caps an over-long description at the API limit', () => {
    const patch = reminderEditPatch(original, {
      description: 'a'.repeat(REMINDER_DESCRIPTION_MAX_LENGTH + 50),
      schedule: onceSchedule(new Date(remindAt)),
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
        { description: 'Chase the contract', schedule: onceSchedule(next) }
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
        { description: 'Follow up', schedule: onceSchedule(new Date(remindAt)) }
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

describe('repeatPartsFromDate', () => {
  // The backend's `cron` crate numbers day-of-week 1=Sunday, while JS
  // `Date.getDay()` numbers it 0=Sunday. Every value here is therefore one
  // higher than the JS one, and getting it wrong lands the reminder a day off —
  // which nobody notices until a week after it ships.
  it('maps each weekday to the backend numbering', () => {
    // 2026-08-09 is a Sunday, so this walks a full week from Sunday.
    const expected = [
      ['2026-08-09', '1'], // Sunday
      ['2026-08-10', '2'], // Monday
      ['2026-08-11', '3'],
      ['2026-08-12', '4'],
      ['2026-08-13', '5'],
      ['2026-08-14', '6'],
      ['2026-08-15', '7'], // Saturday
    ] as const;

    for (const [day, cronDow] of expected) {
      // Local noon, so the date cannot slide across a day boundary via UTC.
      const parts = repeatPartsFromDate(new Date(`${day}T12:00:00`));
      expect(parts.daysOfWeek).toEqual([cronDow]);
    }
  });

  it('takes the time of day and day of month from the date', () => {
    const parts = repeatPartsFromDate(new Date('2026-08-17T14:05:00'));

    expect(parts.time).toBe('14:05');
    expect(parts.dayOfMonth).toBe('17');
  });

  it('defaults to weekly', () => {
    expect(repeatPartsFromDate(new Date('2026-08-17T09:00:00')).frequency).toBe(
      'week'
    );
  });
});

describe('defaultRepeatParts', () => {
  it('starts a new recurrence at the reminder morning default', () => {
    // Not the current time: a repeat picked at 4pm should still default to the
    // morning, the same way a bare date does.
    const parts = defaultRepeatParts(new Date('2026-08-17T16:42:00'));

    expect(parts.time).toBe(
      `${String(REMINDER_DEFAULT_TIME.hours).padStart(2, '0')}:${String(REMINDER_DEFAULT_TIME.minutes).padStart(2, '0')}`
    );
  });
});

describe('recurringSchedule', () => {
  it('builds a cron schedule carrying the timezone it was built in', () => {
    const schedule = recurringSchedule(
      // 2026-08-10 is a Monday, which is 2 in the backend's numbering.
      repeatPartsFromDate(new Date('2026-08-10T09:00:00')),
      'America/Denver'
    );

    expect(schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 * * 2',
      timezone: 'America/Denver',
    });
  });

  it('builds a weekly cron on the date it was seeded from', () => {
    // 2026-08-10 is a Monday, which is 2 in the backend's numbering.
    const schedule = recurringSchedule(
      repeatPartsFromDate(new Date('2026-08-10T09:00:00'), 'week'),
      'UTC'
    );

    expect(isRecurring(schedule) && schedule.cron).toBe('0 0 9 * * 2');
  });
});

describe('repeatPartsFromSchedule', () => {
  it('reads an existing recurrence back into picker parts', () => {
    const parts = repeatPartsFromSchedule({
      type: 'recurring',
      cron: '0 30 14 * * 2-6',
      timezone: 'UTC',
    });

    expect(parts.frequency).toBe('week');
    expect(parts.time).toBe('14:30');
    expect(parts.daysOfWeek).toEqual(['2', '3', '4', '5', '6']);
  });

  it('seeds from the firing when the reminder does not repeat yet', () => {
    // Turning a one-shot into a recurrence should start from the time it was
    // already set for, not from an unrelated default.
    const parts = repeatPartsFromSchedule({
      type: 'once',
      remindAt: new Date('2026-08-10T07:15:00').toISOString(),
    });

    expect(parts.time).toBe('07:15');
  });
});

describe('describeReminderSchedule', () => {
  it('describes a recurrence, capitalized for a row', () => {
    const described = describeReminderSchedule({
      type: 'recurring',
      cron: '0 0 9 * * 2-6',
      timezone: 'UTC',
    });

    expect(described).toMatch(/^Weekdays at /);
  });

  it('says nothing for a one-shot, whose date is already shown', () => {
    expect(
      describeReminderSchedule(onceSchedule(new Date('2026-08-10T09:00:00')))
    ).toBeUndefined();
  });
});

describe('sameSchedule', () => {
  const cron = (expr: string, timezone = 'UTC') =>
    ({ type: 'recurring', cron: expr, timezone }) as const;

  it('matches identical one-shots written differently', () => {
    // The same instant with a different offset and precision is not a change,
    // and treating it as one would re-send a schedule the API then rejects for
    // being in the past.
    expect(
      sameSchedule(
        { type: 'once', remindAt: '2026-08-10T09:00:00.000Z' },
        { type: 'once', remindAt: '2026-08-10T05:00:00-04:00' }
      )
    ).toBe(true);
  });

  it('separates different instants', () => {
    expect(
      sameSchedule(
        { type: 'once', remindAt: '2026-08-10T09:00:00.000Z' },
        { type: 'once', remindAt: '2026-08-10T10:00:00.000Z' }
      )
    ).toBe(false);
  });

  it('matches identical recurrences', () => {
    expect(sameSchedule(cron('0 0 9 * * *'), cron('0 0 9 * * *'))).toBe(true);
  });

  it('separates recurrences differing only by timezone', () => {
    // Same wall-clock, different instant — a real change.
    expect(
      sameSchedule(cron('0 0 9 * * *'), cron('0 0 9 * * *', 'Asia/Tokyo'))
    ).toBe(false);
  });

  it('separates the two kinds of schedule', () => {
    expect(
      sameSchedule(cron('0 0 9 * * *'), {
        type: 'once',
        remindAt: '2026-08-10T09:00:00.000Z',
      })
    ).toBe(false);
  });
});

describe('reminderEditPatch with recurrences', () => {
  const weekdays = {
    type: 'recurring' as const,
    cron: '0 0 9 * * 2-6',
    timezone: 'UTC',
  };
  const original = {
    description: 'Standup',
    schedule: weekdays,
    completed: false,
  };

  it('sends nothing when the recurrence is unchanged', () => {
    expect(
      reminderEditPatch(original, {
        description: 'Standup',
        schedule: weekdays,
      })
    ).toBeUndefined();
  });

  it('sends the new recurrence when it changes', () => {
    const daily = { ...weekdays, cron: '0 0 9 * * *' };

    expect(
      reminderEditPatch(original, { description: 'Standup', schedule: daily })
    ).toEqual({ schedule: daily });
  });

  it('turns a recurrence into a one-shot when asked', () => {
    const once = onceSchedule(new Date('2026-09-01T09:00:00.000Z'));

    expect(
      reminderEditPatch(original, { description: 'Standup', schedule: once })
    ).toEqual({ schedule: once });
  });

  it('clears the done flag when a finished series is given a new schedule', () => {
    const daily = { ...weekdays, cron: '0 0 9 * * *' };

    expect(
      reminderEditPatch(
        { ...original, completed: true },
        { description: 'Standup', schedule: daily }
      )
    ).toEqual({ schedule: daily, completed: false });
  });
});

describe('keeping a recurring schedule unchanged', () => {
  const weekdays = {
    type: 'recurring' as const,
    cron: '0 0 9 * * 2-6',
    timezone: 'America/New_York',
  };

  // The regression this guards is a data-loss one. The date list's lead row for
  // a recurring reminder says "Keep repeating"; if activating it submitted the
  // reminder's *next firing* instead of its schedule, one Enter would collapse
  // a standing series into a single day.
  it('sends no schedule when the existing recurrence is handed back', () => {
    const patch = reminderEditPatch(
      { description: 'Standup', schedule: weekdays, completed: false },
      { description: 'Standup', schedule: weekdays }
    );

    expect(patch).toBeUndefined();
  });

  it('sends only the description when a recurring reminder is renamed', () => {
    const patch = reminderEditPatch(
      { description: 'Standup', schedule: weekdays, completed: false },
      { description: 'Team standup', schedule: weekdays }
    );

    expect(patch).toEqual({ description: 'Team standup' });
    expect(patch?.schedule).toBeUndefined();
  });

  // What it would look like if the keep row ever regressed to submitting a date.
  it('treats the next firing as a real change, which is why keep must not send it', () => {
    const nextFiring = onceSchedule(new Date('2026-08-10T13:00:00.000Z'));

    expect(
      reminderEditPatch(
        { description: 'Standup', schedule: weekdays, completed: false },
        { description: 'Standup', schedule: nextFiring }
      )
    ).toEqual({ schedule: nextFiring });
  });

  it('does not treat a re-spelled equivalent cron as a change', () => {
    // `*` and the full list of days are the same schedule spelled two ways,
    // and which one a reminder carries depends on what last wrote it.
    const asDaily = { ...weekdays, cron: '0 0 9 * * *' };
    const asEveryWeekday = { ...weekdays, cron: '0 0 9 * * 1,2,3,4,5,6,7' };

    expect(
      reminderEditPatch(
        { description: 'Standup', schedule: asDaily, completed: false },
        { description: 'Standup', schedule: asEveryWeekday }
      )
    ).toBeUndefined();
  });
});
