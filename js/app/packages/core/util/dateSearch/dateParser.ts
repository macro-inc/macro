import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
} from 'date-fns';
import { match } from 'ts-pattern';

export type TimeUnit = 'h' | 'd' | 'w' | 'm' | 'y' | 'min';

export interface ParsedDuration {
  value: number;
  unit: TimeUnit;
}

const UNITS = new Set<TimeUnit>(['h', 'd', 'w', 'm', 'y', 'min']);

/**
 * Parses a duration string like "3d", "1w", "36h", "2m", "1y", "30min"
 * Returns null if the input doesn't match the expected format
 */
export function parseDurationString(input: string): ParsedDuration | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const firstLetter = s.search(/[a-z]/);
  if (firstLetter <= 0) return null;

  const numPart = s.slice(0, firstLetter).trim();
  const unitPart = s.slice(firstLetter).trim() as TimeUnit;

  if (!UNITS.has(unitPart)) return null;

  const value = Number(numPart);
  if (!Number.isFinite(value) || value <= 0) return null;

  return { value, unit: unitPart };
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
    min: value === 1 ? 'minute' : 'minutes',
    h: value === 1 ? 'hour' : 'hours',
    d: value === 1 ? 'day' : 'days',
    w: value === 1 ? 'week' : 'weeks',
    m: value === 1 ? 'month' : 'months',
    y: value === 1 ? 'year' : 'years',
  };

  return `${value} ${unitLabels[unit]}`;
}
