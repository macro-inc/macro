/**
 * Recurrence is RFC 5545 (iCalendar RRULE), evaluated by rrule-temporal,
 * which handles zones and DST itself. Temporal has no recurrence type of its
 * own, and RRULE is the standard that sits beside ISO 8601 instants and
 * durations. It also says what cron can't: `BYDAY=-1FR` (the last Friday),
 * `COUNT=5`, `UNTIL=20270101T000000Z`.
 *
 * The library accepts out-of-range parts and silently ignores them:
 * `BYHOUR=25` becomes "every day at whatever time DTSTART is". A typo that
 * turns into a plausible wrong schedule is the failure this module exists to
 * prevent, so `checkRule` checks every part first.
 */
import { RRuleTemporal } from 'rrule-temporal';
import { toText } from 'rrule-temporal/totext';
import { errorMessage } from '../../core/error.ts';
import { timeZone } from '../time/index.ts';

const frequencies = [
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
];
const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Each numeric part's lowest and highest value, and whether 0 is allowed, per RFC 5545 section 3.3.10. */
const ranges: Readonly<
  Record<
    string,
    { readonly low: number; readonly high: number; readonly zero: boolean }
  >
> = {
  BYSECOND: { low: 0, high: 60, zero: true },
  BYMINUTE: { low: 0, high: 59, zero: true },
  BYHOUR: { low: 0, high: 23, zero: true },
  BYMONTHDAY: { low: -31, high: 31, zero: false },
  BYYEARDAY: { low: -366, high: 366, zero: false },
  BYWEEKNO: { low: -53, high: 53, zero: false },
  BYMONTH: { low: 1, high: 12, zero: true },
  BYSETPOS: { low: -366, high: 366, zero: false },
};

/** Where a rule counts its occurrences from, and the zone its wall clock means. */
export type Anchor = { readonly start: Temporal.Instant; readonly tz: string };

const cronLike = /^[\d*]\S*(\s+\S+){4}$/;

const parts = (text: string): readonly (readonly [string, string])[] =>
  text
    .trim()
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((part) => part.trim() !== '')
    .map((part) => {
      const at = part.indexOf('=');
      if (at === -1)
        throw new RangeError(
          cronLike.test(text.trim())
            ? `${text.trim()} looks like cron; recurrence here is RFC 5545, e.g. FREQ=HOURLY;BYMINUTE=1,31`
            : `rrule: ${part.trim()} is not KEY=VALUE`
        );
      return [
        part.slice(0, at).trim().toUpperCase(),
        part
          .slice(at + 1)
          .trim()
          .toUpperCase(),
      ];
    });

const checkPart = (key: string, value: string): void => {
  const range = ranges[key];
  if (range !== undefined) {
    for (const item of value.split(',')) {
      const n = Number(item);
      if (!Number.isInteger(n))
        throw new RangeError(`rrule ${key}: ${item} is not a whole number`);
      if (n < range.low || n > range.high)
        throw new RangeError(
          `rrule ${key}: ${item} is not ${range.low} to ${range.high}`
        );
      if (!range.zero && n === 0)
        throw new RangeError(`rrule ${key}: 0 is not allowed`);
    }
    return;
  }
  switch (key) {
    case 'FREQ':
      if (!frequencies.includes(value))
        throw new RangeError(
          `rrule FREQ: ${value} is not one of ${frequencies.join(', ')}`
        );
      return;
    case 'INTERVAL':
    case 'COUNT': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1)
        throw new RangeError(
          `rrule ${key}: ${value} is not a positive whole number`
        );
      return;
    }
    case 'UNTIL':
      if (!/^\d{8}T\d{6}Z$/.test(value))
        throw new RangeError(
          `rrule UNTIL: ${value} is not a UTC datetime like 20270101T000000Z`
        );
      return;
    case 'BYDAY':
      for (const day of value.split(',')) {
        const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(day);
        if (match === null)
          throw new RangeError(
            `rrule BYDAY: ${day} is not a weekday like MO, or an ordinal one like -1FR`
          );
        if (match[1] !== undefined && Number(match[1]) === 0)
          throw new RangeError('rrule BYDAY: 0 is not an ordinal');
      }
      return;
    case 'WKST':
      if (!weekdays.includes(value))
        throw new RangeError(`rrule WKST: ${value} is not a weekday`);
      return;
    default:
      throw new RangeError(`rrule: ${key} is not a part of an RRULE`);
  }
};

/**
 * Checks every part and returns the rule's canonical form, upper-case with
 * no spaces. Throws a RangeError naming the part that is wrong.
 */
export const checkRule = (text: string): string => {
  const got = parts(text);
  if (got.length === 0) throw new RangeError('rrule: empty');
  const keys = got.map(([key]) => key);
  const twice = keys.find((key, i) => keys.indexOf(key) !== i);
  if (twice !== undefined)
    throw new RangeError(`rrule: ${twice} is given twice`);
  for (const [key, value] of got) {
    if (value === '') throw new RangeError(`rrule ${key}: no value`);
    checkPart(key, value);
  }
  if (!keys.includes('FREQ')) throw new RangeError('rrule: FREQ is required');
  if (keys.includes('COUNT') && keys.includes('UNTIL'))
    throw new RangeError('rrule: COUNT and UNTIL cannot both be given');
  return got.map(([key, value]) => `${key}=${value}`).join(';');
};

/** `20261107T133500`: DTSTART in the zone's own wall clock, to the second. */
const wallClock = (at: Temporal.Instant, tz: string): string =>
  at
    .toZonedDateTimeISO(tz)
    .toString({
      smallestUnit: 'second',
      timeZoneName: 'never',
      offset: 'never',
    })
    .replace(/[-:]/g, '');

const build = (text: string, { start, tz }: Anchor) => {
  const zone = timeZone(tz);
  return new RRuleTemporal({
    rruleString: `DTSTART;TZID=${zone}:${wallClock(start, zone)}\nRRULE:${checkRule(text)}`,
    temporal: Temporal,
  });
};

/**
 * The first occurrence strictly after `after`, or null once the rule has run
 * out (a COUNT or UNTIL). The seconds of every occurrence come from the
 * anchor.
 */
export const nextOccurrence = (
  text: string,
  anchor: Anchor,
  after: Temporal.Instant
): Temporal.Instant | null => {
  const rule = build(text, anchor);
  try {
    return (
      rule.next(after.toZonedDateTimeISO(timeZone(anchor.tz)))?.toInstant() ??
      null
    );
  } catch (error) {
    // The library gives up by iteration count, which tells nobody anything.
    throw new RangeError(
      /iterations/i.test(errorMessage(error))
        ? `rrule ${checkRule(text)} has no occurrence to find (an impossible date, like BYMONTH=2;BYMONTHDAY=30)`
        : `rrule ${text}: ${errorMessage(error)}`
    );
  }
};

/** The last occurrence strictly before `before`, or null if the rule hasn't started yet. */
export const previousOccurrence = (
  text: string,
  anchor: Anchor,
  before: Temporal.Instant
): Temporal.Instant | null => {
  try {
    return (
      build(text, anchor)
        .previous(before.toZonedDateTimeISO(timeZone(anchor.tz)))
        ?.toInstant() ?? null
    );
  } catch {
    // A rule that can't be searched is nextOccurrence's error to report.
    return null;
  }
};

/** What a person reads: `FREQ=HOURLY;BYMINUTE=1,31` is `every hour at minute 1 and 31`. */
export const ruleText = (text: string, anchor: Anchor): string => {
  try {
    return toText(build(text, anchor));
  } catch {
    return text;
  }
};
