/**
 * The `natural_time` wasm module with its results typed: the generated
 * declarations type them `any`. The shapes mirror `natural_time::wasm`; the
 * reading rules are the crate docs in `crates/natural_time/src/lib.rs`.
 */
import naturalTimeWasm from 'wasm:natural-time';

/** Which part of a longer phrase to read, as `natural_time::Pick`. */
type NaturalTimePick = 'start' | 'end' | 'span';

/** A point a phrase names, as `natural_time::Moment`. */
export type NaturalTimeMoment =
  /** A whole day, `2026-11-13`. */
  | { kind: 'day'; date: string }
  /** A local wall-clock time, `2026-11-13T15:00:00`. */
  | { kind: 'at'; local: string }
  /** Elapsed time from now, as in "in 2 hours". */
  | { kind: 'after'; minutes: number };

/** Why a phrase couldn't be read, as `natural_time::Error`. */
export type NaturalTimeError =
  | 'unrecognized'
  | 'repeating'
  | 'conflict'
  | 'invalidDate'
  | 'invalidTime'
  | 'weekdayMismatch'
  | 'durationWithoutTime'
  | 'endBeforeStart'
  | 'outOfRange';

export type NaturalTimeOutcome =
  | {
      outcome: 'read';
      start: NaturalTimeMoment;
      end: NaturalTimeMoment | undefined;
      /** Parts that were guessed rather than written. */
      assumed: { meridiem: boolean; year: boolean; time: boolean };
    }
  | { outcome: 'unread'; error: NaturalTimeError };

/**
 * `now` is the reader's local wall-clock time (`2026-11-06T10:00:00`) and
 * `defaultTime` (`09:00`) is for dates written without a time. Both throw an
 * `Error` only when `now`, `pick` or `defaultTime` is malformed.
 */
type Read = (
  phrase: string,
  now: string,
  pick: NaturalTimePick,
  defaultTime?: string
) => NaturalTimeOutcome;

export interface NaturalTimeWasmModule {
  read: Read;
  /** Reads like `read`, with a guessed am or pm the other way round. */
  readOtherMeridiem: Read;
}

/** Loads the module once per context; a failed load is tried again. */
export async function loadNaturalTimeWasm(): Promise<NaturalTimeWasmModule> {
  // Checked against the generated declarations.
  const reader: NaturalTimeWasmModule = await naturalTimeWasm.load();
  return reader;
}
