// Bun has Temporal, but TypeScript's own types for it aren't out yet.
/// <reference types="temporal-spec/global" />

/**
 * A small, opinionated layer over Temporal. Nothing here reads the clock:
 * the time is always passed in, through a `Clock` or as an argument. The
 * parsers throw a RangeError naming what was wrong, like Temporal does.
 */

/** The time, and a way to wait. Injected, so tests can move time themselves. */
export type Clock = {
  readonly now: () => Temporal.Instant;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

const second = 1_000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

const shorthand = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/** Days are counted as 24 hours, here and in ISO durations. */
const utc = Temporal.ZonedDateTime.from('1970-01-01T00:00Z[UTC]');

/**
 * A length of time in milliseconds, from shorthand like `90s`, `10m`,
 * `1h30m` and `2d`, or ISO 8601 like `PT1H30M`. It must be more than zero.
 */
export const milliseconds = (text: string): number => {
  const trimmed = text.trim();
  const match = shorthand.exec(trimmed);
  const total =
    match !== null && trimmed !== ''
      ? [day, hour, minute, second].reduce(
          (sum, unit, i) => sum + Number(match[i + 1] ?? 0) * unit,
          0
        )
      : iso(trimmed);
  if (total <= 0)
    throw new RangeError(`${text} is not a length of time more than zero`);
  return total;
};

const iso = (text: string): number => {
  try {
    return Temporal.Duration.from(text).total({
      unit: 'milliseconds',
      relativeTo: utc,
    });
  } catch {
    throw new RangeError(
      `${text} is not a length of time like 10m, 1h30m or PT1H30M`
    );
  }
};

/** Milliseconds as shorthand: `5400000` is `1h30m`. */
export const lengthText = (ms: number): string => {
  const units: readonly (readonly [number, string])[] = [
    [day, 'd'],
    [hour, 'h'],
    [minute, 'm'],
    [second, 's'],
  ];
  const { text } = units.reduce(
    ({ rest, text }, [unit, suffix]) => {
      const count = Math.floor(rest / unit);
      return {
        rest: rest - count * unit,
        text: count > 0 ? `${text}${count}${suffix}` : text,
      };
    },
    { rest: ms, text: '' }
  );
  return text === '' ? `${ms}ms` : text;
};

/** The canonical name of an IANA time zone, e.g. `America/New_York`. */
export const timeZone = (name: string): string => {
  try {
    return new Temporal.ZonedDateTime(0n, name).timeZoneId;
  } catch {
    throw new RangeError(`${name} is not a time zone like America/New_York`);
  }
};

/** One fixed instant, with its offset: `2026-11-09T15:00:00Z` or `2026-11-09T10:00:00-05:00`. */
export const instant = (text: string): Temporal.Instant => {
  try {
    return Temporal.Instant.from(text);
  } catch {
    throw new RangeError(
      `${text} is not a fixed instant like 2026-11-09T15:00:00Z; give it a Z or an offset`
    );
  }
};

/** An instant as stored: ISO 8601 in UTC, to the second. */
export const isoText = (at: Temporal.Instant): string =>
  at.toString({ smallestUnit: 'second' });
