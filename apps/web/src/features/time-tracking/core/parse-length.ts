/** The longest entry the server accepts, in minutes: 24 hours. */
export const MAX_ENTRY_MINUTES = 24 * 60;

/** What a typed length was understood as. */
export type ParsedLength =
  /** A length the server accepts, in whole minutes. */
  | { kind: 'length'; minutes: number }
  /** A real length, but longer than one entry may be. */
  | { kind: 'too-long'; minutes: number }
  /** Nothing that reads as a length. */
  | { kind: 'invalid' };

const HOUR_UNIT = '(?:h|hr|hrs|hour|hours)';
const MINUTE_UNIT = '(?:m|min|mins|minute|minutes)';
const DECIMAL = '\\d+(?:[.,]\\d+)?|[.,]\\d+';

const HOURS_AND_MINUTES = new RegExp(
  `^(\\d+)\\s*${HOUR_UNIT}\\s*(\\d+)\\s*(?:${MINUTE_UNIT})?$`
);
const HOURS = new RegExp(`^(${DECIMAL})\\s*${HOUR_UNIT}?$`);
const MINUTES = new RegExp(`^(${DECIMAL})\\s*${MINUTE_UNIT}$`);
const CLOCK = /^(\d+):([0-5]\d)$/;

function decimal(text: string): number {
  return Number(text.replace(',', '.'));
}

function understood(minutes: number): ParsedLength {
  const whole = Math.round(minutes);
  if (!Number.isFinite(whole) || minutes <= 0) return { kind: 'invalid' };
  const length = Math.max(1, whole);
  return length > MAX_ENTRY_MINUTES
    ? { kind: 'too-long', minutes: length }
    : { kind: 'length', minutes: length };
}

/**
 * Read a typed length: `1h 30m`, `1h30`, `1 h 30 min`, `1.5h`, `1,5h`,
 * `90m`, `1:30`, or a bare number of hours (`1.5`, `2`). Whole minutes,
 * rounded to the nearest and at least one.
 */
export function parseLength(input: string): ParsedLength {
  const text = input.trim().toLowerCase();
  const both = HOURS_AND_MINUTES.exec(text);
  if (both) return understood(Number(both[1]) * 60 + Number(both[2]));
  const clock = CLOCK.exec(text);
  if (clock) return understood(Number(clock[1]) * 60 + Number(clock[2]));
  const minutes = MINUTES.exec(text);
  if (minutes) return understood(decimal(minutes[1]));
  const hours = HOURS.exec(text);
  if (hours) return understood(decimal(hours[1]) * 60);
  return { kind: 'invalid' };
}
