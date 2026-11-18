/**
 * What a schedule is, as it is kept in state. A schedule is one of three
 * kinds, decided by the key that is there: `every` (a length of time after
 * the last run ended), `rule` (wall-clock points, RFC 5545) or `at` (one
 * instant). There is no `kind` field to disagree with the rest, and the
 * schemas are strict, so an entry with two of those keys is no kind at all.
 */
import { z } from 'zod';
import { errorMessage } from '../../core/error.ts';
import { instant, milliseconds, timeZone } from '../time/index.ts';
import { checkRule } from './rrule.ts';

const common = {
  /** Why it exists, for whoever reads it next. */
  why: z.string().optional(),
  /** Handed to the handlers with every firing, e.g. what a reminder should say. */
  data: z.json().optional(),
  /** How late a firing may be and still happen. Default 5m, or 1h for `at`. */
  grace: z.string().optional(),
};

export const Every = z.strictObject({ every: z.string(), ...common });

export const Rule = z.strictObject({
  rule: z.string(),
  /**
   * The instant its occurrences are counted from. `FREQ=DAILY` alone means
   * "every day at the anchor's time", so a rule that doesn't pin its time
   * with BYHOUR and BYMINUTE uses this. Defaults to the Unix epoch, so the
   * same rule always fires at the same times, whenever it was added.
   */
  from: z.string().optional(),
  /** The zone its wall clock means. Defaults to the scheduler's. */
  tz: z.string().optional(),
  /** After downtime, fire the occurrence that was missed instead of skipping it. */
  catchUp: z.boolean().optional(),
  ...common,
});

export const Once = z.strictObject({ at: z.string(), ...common });

export const Schedule = z.union([Every, Rule, Once]);

export type Every = z.infer<typeof Every>;
export type Rule = z.infer<typeof Rule>;
export type Once = z.infer<typeof Once>;
export type Schedule = z.infer<typeof Schedule>;

export type Kind = 'every' | 'rule' | 'once';

export const kindOf = (schedule: Schedule): Kind =>
  'every' in schedule ? 'every' : 'rule' in schedule ? 'rule' : 'once';

/** The anchor a rule with no `from` counts from. */
export const epoch = '1970-01-01T00:00:00Z';

const name = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * What a schema can't check: that the strings mean something. Returns what
 * is wrong, naming the field, or undefined if nothing is.
 */
export const check = (
  scheduleName: string,
  schedule: Schedule
): string | undefined => {
  if (!name.test(scheduleName))
    return `${scheduleName} is not a schedule name: use lower-case letters, digits and dashes`;
  const field = (label: string, read: () => unknown): string | undefined => {
    try {
      read();
      return undefined;
    } catch (error) {
      return `${label}: ${errorMessage(error)}`;
    }
  };
  const fields = [
    schedule.grace === undefined
      ? undefined
      : field('grace', () => milliseconds(schedule.grace ?? '')),
    ...('every' in schedule
      ? [field('every', () => milliseconds(schedule.every))]
      : []),
    ...('rule' in schedule
      ? [
          field('rule', () => checkRule(schedule.rule)),
          field('from', () => instant(schedule.from ?? epoch)),
          schedule.tz === undefined
            ? undefined
            : field('tz', () => timeZone(schedule.tz ?? '')),
        ]
      : []),
    ...('at' in schedule ? [field('at', () => instant(schedule.at))] : []),
  ];
  return fields.find((problem) => problem !== undefined);
};
