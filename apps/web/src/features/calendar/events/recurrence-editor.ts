import { format } from 'date-fns';
import { parseRecurrenceLines } from './recurrence-description';

/** Weekday codes in RFC 5545 order for a Sunday-first chip row. */
export const WEEKDAY_CODES = [
  'SU',
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
] as const;

export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

const WORKWEEK: readonly WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** How a recurrence ends. */
export type RecurrenceEnds =
  | { kind: 'never' }
  | { kind: 'on'; date: string }
  | { kind: 'after'; count: number };

/** The recurrence shapes the editor can express and round-trip. */
export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  /** Every N frequency units; 1 is omitted from the rule. */
  interval: number;
  /** Weekly-only weekday selectors. */
  byDay: WeekdayCode[];
  /** Monthly-only positional weekday, e.g. first Friday = `{ 1, FR }`. */
  monthlyByDay?: { ordinal: number; weekday: WeekdayCode };
  ends: RecurrenceEnds;
}

const NEVER: RecurrenceEnds = { kind: 'never' };

/**
 * RFC 5545 `UNTIL` closing an inclusive local end date, Google-style:
 * all-day rules carry the plain date, timed rules the local end-of-day
 * instant rendered in UTC.
 */
function untilValue(date: string, allDay: boolean) {
  if (allDay) return date.replaceAll('-', '');
  const endOfDay = new Date(`${date}T23:59:59`);
  return `${endOfDay.toISOString().slice(0, 19).replaceAll(/[-:]/g, '')}Z`;
}

/** The local calendar date a stored `UNTIL` value ends on (inclusive). */
function untilDate(value: string): string | undefined {
  const match = value.match(
    /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})Z)?$/
  );
  if (!match) return undefined;
  if (match[4] === undefined) return `${match[1]}-${match[2]}-${match[3]}`;
  const instant = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    )
  );
  return format(instant, 'yyyy-MM-dd');
}

/** Serialize a config into a single-`RRULE` recurrence property list. */
export function buildRecurrenceLines(
  config: RecurrenceConfig,
  allDay: boolean
): string[] {
  const parts = [`FREQ=${config.frequency}`];
  if (config.interval > 1) {
    parts.push(`INTERVAL=${config.interval}`);
  }
  if (config.frequency === 'WEEKLY' && config.byDay.length > 0) {
    const ordered = WEEKDAY_CODES.filter((code) => config.byDay.includes(code));
    parts.push(`BYDAY=${ordered.join(',')}`);
  }
  if (config.frequency === 'MONTHLY' && config.monthlyByDay) {
    parts.push(
      `BYDAY=${config.monthlyByDay.ordinal}${config.monthlyByDay.weekday}`
    );
  }
  if (config.ends.kind === 'on') {
    parts.push(`UNTIL=${untilValue(config.ends.date, allDay)}`);
  } else if (config.ends.kind === 'after') {
    parts.push(`COUNT=${config.ends.count}`);
  }
  return [`RRULE:${parts.join(';')}`];
}

/**
 * Parse recurrence properties into an editable config. Returns `undefined`
 * for rules the editor cannot round-trip (extra dates, exclusions, or
 * selectors beyond its vocabulary), which the UI keeps untouched instead.
 */
export function parseRecurrenceConfig(
  lines: string[]
): RecurrenceConfig | undefined {
  if (lines.length === 0) return undefined;
  const parsed = parseRecurrenceLines(lines);
  const rule = parsed.rule;
  if (
    !rule ||
    parsed.additionalDates.length > 0 ||
    parsed.excludedDates.length > 0 ||
    lines.length > 1
  ) {
    return undefined;
  }
  if (
    rule.frequency !== 'DAILY' &&
    rule.frequency !== 'WEEKLY' &&
    rule.frequency !== 'MONTHLY' &&
    rule.frequency !== 'YEARLY'
  ) {
    return undefined;
  }
  if (rule.byMonthDay.length > 0 || rule.byMonth.length > 0) {
    return undefined;
  }
  if (rule.count !== undefined && rule.until !== undefined) {
    return undefined;
  }

  let byDay: WeekdayCode[] = [];
  let monthlyByDay: RecurrenceConfig['monthlyByDay'];
  if (rule.byDay.length > 0) {
    if (rule.frequency === 'WEEKLY') {
      if (rule.byDay.some((day) => day.ordinal !== undefined)) {
        return undefined;
      }
      byDay = rule.byDay.map((day) => day.weekday);
    } else if (rule.frequency === 'MONTHLY' && rule.byDay.length === 1) {
      const [day] = rule.byDay;
      if (day?.ordinal === undefined) return undefined;
      monthlyByDay = { ordinal: day.ordinal, weekday: day.weekday };
    } else {
      return undefined;
    }
  }

  let ends: RecurrenceEnds = NEVER;
  if (rule.count !== undefined) {
    ends = { kind: 'after', count: rule.count };
  } else if (rule.until !== undefined) {
    const date = untilDate(rule.until);
    if (date === undefined) return undefined;
    ends = { kind: 'on', date };
  }

  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byDay,
    monthlyByDay,
    ends,
  };
}

/** The positional weekday Google's monthly preset uses: 1st–4th, else last. */
export function monthlyOrdinalFor(start: Date): {
  ordinal: number;
  weekday: WeekdayCode;
} {
  const nth = Math.ceil(start.getDate() / 7);
  return {
    ordinal: nth === 5 ? -1 : nth,
    weekday: WEEKDAY_CODES[start.getDay()] as WeekdayCode,
  };
}

/** One entry in the recurrence preset dropdown. */
export interface RecurrencePreset {
  id: string;
  label: string;
  config: RecurrenceConfig;
}

const ORDINAL_LABELS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
};

/** Google Calendar's preset list, phrased from the event's start date. */
export function recurrencePresetsFor(start: Date): RecurrencePreset[] {
  const weekday = WEEKDAY_CODES[start.getDay()] as WeekdayCode;
  const weekdayName = format(start, 'EEEE');
  const monthly = monthlyOrdinalFor(start);
  return [
    {
      id: 'daily',
      label: 'Daily',
      config: { frequency: 'DAILY', interval: 1, byDay: [], ends: NEVER },
    },
    {
      id: 'weekly',
      label: `Weekly on ${weekdayName}`,
      config: {
        frequency: 'WEEKLY',
        interval: 1,
        byDay: [weekday],
        ends: NEVER,
      },
    },
    {
      id: 'monthly',
      label: `Monthly on the ${ORDINAL_LABELS[monthly.ordinal]} ${weekdayName}`,
      config: {
        frequency: 'MONTHLY',
        interval: 1,
        byDay: [],
        monthlyByDay: monthly,
        ends: NEVER,
      },
    },
    {
      id: 'annually',
      label: `Annually on ${format(start, 'MMMM d')}`,
      config: { frequency: 'YEARLY', interval: 1, byDay: [], ends: NEVER },
    },
    {
      id: 'weekdays',
      label: 'Every weekday (Monday to Friday)',
      config: {
        frequency: 'WEEKLY',
        interval: 1,
        byDay: [...WORKWEEK],
        ends: NEVER,
      },
    },
  ];
}

/** Whether two configs produce the same rule. */
export function recurrenceConfigsEqual(
  first: RecurrenceConfig,
  second: RecurrenceConfig
): boolean {
  return (
    buildRecurrenceLines(first, false).join('\n') ===
    buildRecurrenceLines(second, false).join('\n')
  );
}

/** A sensible starting point for the custom editor. */
export function defaultCustomConfig(start: Date): RecurrenceConfig {
  return {
    frequency: 'WEEKLY',
    interval: 1,
    byDay: [WEEKDAY_CODES[start.getDay()] as WeekdayCode],
    ends: NEVER,
  };
}
