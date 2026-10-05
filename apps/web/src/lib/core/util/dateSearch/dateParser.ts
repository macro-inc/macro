import {
  addDays,
  addHours,
  addMilliseconds,
  addMinutes,
  addMonths,
  addSeconds,
  addWeeks,
  addYears,
} from 'date-fns';
import { match } from 'ts-pattern';

export type TimeUnit = 'h' | 'd' | 'w' | 'm' | 'y' | 'min' | 's' | 'ms';

export interface ParsedDuration {
  value: number;
  unit: TimeUnit;
}

const UNITS = new Set<TimeUnit>(['h', 'd', 'w', 'm', 'y', 'min', 's', 'ms']);

const UNIT_ALIASES: Record<string, TimeUnit> = {
  hours: 'h',
  hour: 'h',
  hr: 'h',
  hrs: 'h',
  days: 'd',
  day: 'd',
  weeks: 'w',
  week: 'w',
  wk: 'w',
  wks: 'w',
  months: 'm',
  month: 'm',
  mo: 'm',
  mos: 'm',
  years: 'y',
  year: 'y',
  yr: 'y',
  yrs: 'y',
  minutes: 'min',
  minute: 'min',
  mins: 'min',
  seconds: 's',
  second: 's',
  sec: 's',
  secs: 's',
};

/**
 * Parses a duration string like "3d", "1w", "36h", "2m", "1y", "30min", "3 days"
 * Returns null if the input doesn't match the expected format
 */
export function parseDurationString(input: string): ParsedDuration | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const firstLetter = s.search(/[a-z]/);
  if (firstLetter <= 0) return null;

  const numPart = s.slice(0, firstLetter).trim();
  let unitPart = s.slice(firstLetter).trim() as TimeUnit;

  // Resolve word aliases to short units
  if (!UNITS.has(unitPart) && unitPart in UNIT_ALIASES) {
    unitPart = UNIT_ALIASES[unitPart];
  }

  if (!UNITS.has(unitPart)) return null;

  const value = Number(numPart);
  if (!Number.isFinite(value) || value <= 0) return null;

  return { value, unit: unitPart };
}

/**
 * Converts a parsed duration to milliseconds
 */
export function parsedDurationToMilliseconds(duration: ParsedDuration): number {
  const value = duration.value;
  const unit = duration.unit;

  return match(unit)
    .with('ms', () => value)
    .with('s', () => value * 1000)
    .with('min', () => value * 60 * 1000)
    .with('h', () => value * 60 * 60 * 1000)
    .with('d', () => value * 24 * 60 * 60 * 1000)
    .with('w', () => value * 7 * 24 * 60 * 60 * 1000)
    .with('m', () => value * 30 * 24 * 60 * 60 * 1000) // Approximate: 30 days
    .with('y', () => value * 365 * 24 * 60 * 60 * 1000) // Approximate: 365 days
    .otherwise(() => 0);
}

/**
 * Converts a parsed duration to a Date object relative to a base date
 */
export function applyDurationToDate(
  baseDate: Date,
  duration: ParsedDuration
): Date {
  const value = Math.round(duration.value);
  const unit = duration.unit;

  return match(unit)
    .with('ms', () => addMilliseconds(baseDate, value))
    .with('s', () => addSeconds(baseDate, value))
    .with('min', () => addMinutes(baseDate, value))
    .with('h', () => addHours(baseDate, value))
    .with('d', () => addDays(baseDate, value))
    .with('w', () => addWeeks(baseDate, value))
    .with('m', () => addMonths(baseDate, value))
    .with('y', () => addYears(baseDate, value))
    .otherwise(() => baseDate);
}

/**
 * Main parser function that takes a duration string and returns a Date
 */
export function parseDateFromDuration(
  input: string,
  baseDate: Date = new Date()
): Date | null {
  const parsed = parseDurationString(input);
  if (!parsed) {
    return null;
  }
  return applyDurationToDate(baseDate, parsed);
}

/**
 * Checks if a string could be a duration string (for real-time validation)
 */
export function couldBeDurationString(input: string): boolean {
  const trimmed = input.trim().toLowerCase();

  // empty string could become a duration
  if (trimmed === '') return true;

  // just a number could become a duration (including partial decimals like "3.")
  if (/^\d+(?:\.\d*)?$/.test(trimmed)) return true;

  // number followed by valid unit letters
  if (/^\d+(?:\.\d+)?\s*[hdwmy]?$/.test(trimmed)) return true;

  // special case for "min"
  if (/^\d+(?:\.\d+)?\s*m?i?n?$/.test(trimmed)) return true;

  return false;
}

/**
 * Format a duration for display
 */
export function formatDuration(duration: ParsedDuration): string {
  const { value, unit } = duration;

  const unitLabels: Record<TimeUnit, string> = {
    ms: value === 1 ? 'millisecond' : 'milliseconds',
    s: value === 1 ? 'second' : 'seconds',
    min: value === 1 ? 'minute' : 'minutes',
    h: value === 1 ? 'hour' : 'hours',
    d: value === 1 ? 'day' : 'days',
    w: value === 1 ? 'week' : 'weeks',
    m: value === 1 ? 'month' : 'months',
    y: value === 1 ? 'year' : 'years',
  };

  return `${value} ${unitLabels[unit]}`;
}
