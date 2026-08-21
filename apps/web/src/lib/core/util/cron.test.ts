import { describe, expect, it } from 'vitest';

import {
  buildCron,
  type CronParts,
  DEFAULT_TIME,
  describeCron,
  isValidCronParts,
  isValidTime,
  normalizeCron,
  parseCron,
} from './cron';

/** Weekly on Monday and Wednesday at 09:00, in cron's 1=Sun numbering. */
const weekly: CronParts = {
  frequency: 'week',
  time: '09:00',
  daysOfWeek: ['2', '4'],
  dayOfMonth: '1',
};

/** Weekly with every day ticked, which is how "every day" is now said. */
const everyDay: CronParts = {
  frequency: 'week',
  time: '09:00',
  daysOfWeek: ['1', '2', '3', '4', '5', '6', '7'],
  dayOfMonth: '1',
};

const monthly: CronParts = {
  frequency: 'month',
  time: '14:30',
  daysOfWeek: ['2', '3', '4', '5', '6'],
  dayOfMonth: '15',
};

describe('buildCron', () => {
  it('emits six fields, since that is what the cron crate parses', () => {
    for (const parts of [everyDay, weekly, monthly]) {
      expect(buildCron(parts).split(' ')).toHaveLength(6);
    }
  });

  it('builds every day as the full list of days', () => {
    expect(buildCron(everyDay)).toBe('0 0 9 * * 1,2,3,4,5,6,7');
  });

  it('builds a weekly schedule from the selected days', () => {
    // 2=Mon, 4=Wed. Getting this numbering wrong shifts every weekly
    // schedule by a day, which is why it is asserted literally.
    expect(buildCron(weekly)).toBe('0 0 9 * * 2,4');
  });

  it('sorts the selected days so the same selection is one expression', () => {
    expect(buildCron({ ...weekly, daysOfWeek: ['4', '2'] })).toBe(
      '0 0 9 * * 2,4'
    );
  });

  it('builds a monthly schedule on the chosen day', () => {
    expect(buildCron(monthly)).toBe('0 30 14 15 * *');
  });

  it('falls back to the default time when the time is malformed', () => {
    const [, minute, hour] = buildCron({ ...everyDay, time: 'nonsense' }).split(
      ' '
    );
    const [defaultHour, defaultMinute] = DEFAULT_TIME.split(':').map(Number);
    expect(Number(hour)).toBe(defaultHour);
    expect(Number(minute)).toBe(defaultMinute);
  });

  it('falls back to the first of the month for an out-of-range day', () => {
    expect(buildCron({ ...monthly, dayOfMonth: '99' })).toBe('0 30 14 1 * *');
  });

  it('leaves day-of-week unconstrained when a weekly selection is empty', () => {
    // Better than emitting an empty field, which would not parse at all.
    expect(buildCron({ ...weekly, daysOfWeek: [] })).toBe('0 0 9 * * *');
  });
});

describe('parseCron', () => {
  it('round-trips everything buildCron produces', () => {
    for (const parts of [everyDay, weekly, monthly]) {
      const reparsed = parseCron(buildCron(parts));
      expect(reparsed.frequency).toBe(parts.frequency);
      expect(reparsed.time).toBe(parts.time);
      if (parts.frequency === 'week') {
        expect(reparsed.daysOfWeek).toEqual(parts.daysOfWeek);
      }
      if (parts.frequency === 'month') {
        expect(reparsed.dayOfMonth).toBe(parts.dayOfMonth);
      }
    }
  });

  it('reads an unconstrained day-of-week as every day of the week', () => {
    // There is no separate daily frequency: `*` and the full list are the same
    // schedule, and the picker only knows how to show the latter.
    const parts = parseCron('0 0 9 * * *');
    expect(parts.frequency).toBe('week');
    expect(parts.daysOfWeek).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('expands a day-of-week range', () => {
    const parts = parseCron('0 0 9 * * 2-6');
    expect(parts.frequency).toBe('week');
    expect(parts.daysOfWeek).toEqual(['2', '3', '4', '5', '6']);
  });

  it('expands a day-of-week list out of order', () => {
    expect(parseCron('0 0 9 * * 6,2').daysOfWeek).toEqual(['2', '6']);
  });

  it('accepts the seven-field form when the year constrains nothing', () => {
    const parts = parseCron('0 0 9 * * 2 *');
    expect(parts.frequency).toBe('week');
    expect(parts.daysOfWeek).toEqual(['2']);
  });

  it('falls back for a specific year, which the picker cannot show', () => {
    // "9am Mondays during 2026" is a real constraint with no control to express
    // it. Reading it as plain weekly would present it as firing forever, and
    // saving from that view would drop the year without saying so.
    const parts = parseCron('0 0 9 * * 2 2026');

    expect(parts.daysOfWeek).toEqual(['2', '3', '4', '5', '6']);
    // The time is still readable, and losing it as well would reset the hour
    // the reminder was actually set for.
    expect(parts.time).toBe('09:00');
  });

  it('keeps the time it could read even when the rest is unrepresentable', () => {
    // A specific month is not something the picker can express, but the time
    // still is — losing it too would silently reset the user's hour.
    const parts = parseCron('0 30 14 1 3 *');
    expect(parts.time).toBe('14:30');
  });

  it('falls back for a five-field expression', () => {
    // The conventional form, which the cron crate does not accept.
    const parts = parseCron('0 9 * * *');
    expect(parts.frequency).toBe('week');
    expect(parts.time).toBe(DEFAULT_TIME);
  });

  it('falls back for an unreadable day-of-week', () => {
    expect(parseCron('0 0 9 * * 9-2').frequency).toBe('week');
    expect(parseCron('0 0 9 * * mon').daysOfWeek).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('falls back for garbage', () => {
    expect(parseCron('').frequency).toBe('week');
    expect(parseCron('not a cron').time).toBe(DEFAULT_TIME);
  });
});

/**
 * `09:00` as the runtime's locale writes it.
 *
 * Derived rather than written out: `describeCron` formats through `Intl` with no
 * fixed locale — deliberately, so the viewer sees their own convention — so
 * hard-coding "9:00 AM" would fail on any runtime that writes "9:00 a.m.". What
 * these assertions are pinning is the frequency wording around the time, not
 * the time itself.
 */
const NINE_AM = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(2026, 0, 1, 9, 0));

describe('describeCron', () => {
  it('names the sets of days that have a name', () => {
    const week = (daysOfWeek: string[]) =>
      describeCron({ ...weekly, daysOfWeek });

    expect(week(['1', '2', '3', '4', '5', '6', '7'])).toBe(
      `every day at ${NINE_AM}`
    );
    expect(week(['2', '3', '4', '5', '6'])).toBe(`weekdays at ${NINE_AM}`);
    expect(week(['1', '7'])).toBe(`weekends at ${NINE_AM}`);
  });

  it('lists days that have no collective name', () => {
    expect(describeCron(weekly)).toBe(`Monday, Wednesday at ${NINE_AM}`);
  });

  it('ordinalizes the day of the month', () => {
    const on = (dayOfMonth: string) =>
      describeCron({ ...monthly, dayOfMonth, time: '09:00' });

    expect(on('1')).toBe(`1st of each month at ${NINE_AM}`);
    expect(on('2')).toBe(`2nd of each month at ${NINE_AM}`);
    expect(on('3')).toBe(`3rd of each month at ${NINE_AM}`);
    expect(on('4')).toBe(`4th of each month at ${NINE_AM}`);
    // The teens are the case a naive suffix rule gets wrong.
    expect(on('11')).toBe(`11th of each month at ${NINE_AM}`);
    expect(on('12')).toBe(`12th of each month at ${NINE_AM}`);
    expect(on('13')).toBe(`13th of each month at ${NINE_AM}`);
    expect(on('21')).toBe(`21st of each month at ${NINE_AM}`);
  });

  it('appends the timezone when given one', () => {
    expect(describeCron(everyDay, 'America/New_York')).toBe(
      `every day at ${NINE_AM} (America/New_York)`
    );
  });
});

describe('isValidTime', () => {
  it('accepts times in range', () => {
    for (const time of ['00:00', '09:00', '13:45', '23:59']) {
      expect(isValidTime(time)).toBe(true);
    }
  });

  // The shape check alone let these through, which meant the repeat picker
  // reported the schedule as valid, allowed it to be saved, and stored the
  // default time instead — the UI and the stored schedule disagreeing.
  it('rejects times out of range', () => {
    for (const time of ['24:00', '99:99', '12:60', '25:30']) {
      expect(isValidTime(time)).toBe(false);
    }
  });

  it('rejects anything that is not two digits and two digits', () => {
    for (const time of ['', '9:00', '09:0', 'nine', '09:00:00']) {
      expect(isValidTime(time)).toBe(false);
    }
  });
});

describe('isValidCronParts', () => {
  it('accepts each frequency at its defaults', () => {
    for (const parts of [everyDay, weekly, monthly]) {
      expect(isValidCronParts(parts)).toBe(true);
    }
  });

  it('rejects any frequency with an unusable time', () => {
    for (const parts of [everyDay, weekly, monthly]) {
      expect(isValidCronParts({ ...parts, time: '24:00' })).toBe(false);
    }
  });

  // `buildCron` maps an out-of-range day to the 1st, so without this the
  // summary would say one thing and the saved schedule do another.
  it('rejects a monthly day outside 1-31', () => {
    for (const dayOfMonth of ['0', '32', '99', '', 'x', '1.5']) {
      expect(isValidCronParts({ ...monthly, dayOfMonth })).toBe(false);
    }
  });

  it('accepts the edges of the month', () => {
    for (const dayOfMonth of ['1', '31']) {
      expect(isValidCronParts({ ...monthly, dayOfMonth })).toBe(true);
    }
  });

  // An empty weekly selection builds an every-day cron, which is the opposite
  // of what unticking your last day is asking for.
  it('rejects a weekly schedule with no days selected', () => {
    expect(isValidCronParts({ ...weekly, daysOfWeek: [] })).toBe(false);
  });

  it('ignores the day field the frequency does not use', () => {
    // Each frequency reads exactly one of them, so junk in the other is not a
    // reason to refuse a schedule the user can actually see.
    expect(isValidCronParts({ ...weekly, dayOfMonth: '99' })).toBe(true);
    expect(isValidCronParts({ ...monthly, daysOfWeek: [] })).toBe(true);
  });
});

describe('normalizeCron', () => {
  it('gives the two spellings of every day the same form', () => {
    // These are the same schedule, and a comparison that called them different
    // would read a re-save as an edit.
    expect(normalizeCron('0 0 9 * * 1,2,3,4,5,6,7')).toBe(
      normalizeCron('0 0 9 * * *')
    );
  });

  it('leaves a partial week alone', () => {
    expect(normalizeCron('0 0 9 * * 2,4')).toBe('0 0 9 * * 2,4');
  });

  it('is stable when applied twice', () => {
    for (const cron of ['0 0 9 * * *', '0 0 9 * * 2-6', '0 30 14 15 * *']) {
      expect(normalizeCron(normalizeCron(cron))).toBe(normalizeCron(cron));
    }
  });

  // Every expression the picker cannot express parses to the same weekly
  // fallback. Normalizing through that would make two unrelated schedules
  // compare equal — and an equality check answering "unchanged" about a real
  // change does not send the patch, silently discarding the user's edit.
  it('leaves an expression it cannot represent exactly as it was', () => {
    for (const cron of ['0 0 9 1 3 *', 'not a cron', '0 9 * * *', '']) {
      expect(normalizeCron(cron)).toBe(cron);
    }
  });

  it('keeps two different unrepresentable schedules distinct', () => {
    expect(normalizeCron('0 0 9 1 3 *')).not.toBe(normalizeCron('0 0 9 1 6 *'));
  });

  it('does not equate an unrepresentable schedule with the fallback it parses to', () => {
    // The specific collision that would swallow an edit: opening a March-only
    // reminder and saving it as weekdays has to register as a change.
    const marchOnly = '0 0 9 1 3 *';
    const weekdays = buildCron(parseCron(marchOnly));

    expect(normalizeCron(marchOnly)).not.toBe(normalizeCron(weekdays));
  });

  it('treats a year constraint as unrepresentable', () => {
    // The picker has no way to show a year, so rewriting the expression would
    // drop the constraint while reporting the schedule as unchanged.
    const yearly = '0 0 9 * * 2 2026';

    expect(normalizeCron(yearly)).toBe(yearly);
  });

  it('still normalizes a seven-field expression with an open year', () => {
    // `*` in the year field constrains nothing, so it stays representable.
    expect(normalizeCron('0 0 9 * * * *')).toBe('0 0 9 * * 1,2,3,4,5,6,7');
  });
});

describe('normalizeCron on fields the picker cannot express', () => {
  // Each of these is valid to the backend and none is something the picker can
  // show. Rewriting them would change a real schedule — and worse, make a
  // genuine edit normalize to the same string as the original, so the diff
  // reports "unchanged" and the patch is never sent.
  it('leaves an hour range alone', () => {
    // `toTimeValue` cannot read `9-17` and answers with the default, so without
    // a guard this normalized to plain 09:00 daily.
    expect(normalizeCron('0 0 9-17 * * *')).toBe('0 0 9-17 * * *');
  });

  it('leaves a seconds offset alone', () => {
    // `30 0 9 * * *` means 09:00:30. The picker only builds whole minutes.
    expect(normalizeCron('30 0 9 * * *')).toBe('30 0 9 * * *');
  });

  it('leaves minute and hour lists and steps alone', () => {
    for (const cron of ['0 0,30 9 * * *', '0 */15 9 * * *', '0 0 9,17 * * *']) {
      expect(normalizeCron(cron)).toBe(cron);
    }
  });

  it('keeps an hour range distinct from the time it would have collapsed to', () => {
    // The comparison this protects: a stored range and a draft rebuilt as a
    // single hour must not look identical.
    expect(normalizeCron('0 0 9-17 * * *')).not.toBe(
      normalizeCron('0 0 9 * * *')
    );
  });

  it('still normalizes plain in-range fields', () => {
    expect(normalizeCron('0 0 9 * * *')).toBe('0 0 9 * * 1,2,3,4,5,6,7');
  });
});
