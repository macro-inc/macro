/**
 * Typed surface of the `natural_time` wasm package, loaded on first use.
 * `just build-natural-time-wasm` builds it into the gitignored `./wasm/`.
 * The shapes mirror `natural_time::wasm`; the reading rules are the crate
 * docs in `crates/types/natural_time/src/lib.rs`.
 */

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
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  read: Read;
  /** Reads like `read`, with a guessed am or pm the other way round. */
  readOtherMeridiem: Read;
}

let modulePromise: Promise<NaturalTimeWasmModule> | undefined;

/** Loads and initializes the wasm module once per context; a failed load is tried again. */
export function loadNaturalTimeWasm(): Promise<NaturalTimeWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const url = new URL('./wasm/natural_time.js', import.meta.url).href;
        const wasm = (await import(
          /* @vite-ignore */ url
        )) as NaturalTimeWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/natural_time_bg.wasm', import.meta.url);
        await wasm.default({ module_or_path: wasmUrl });
        return wasm;
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}
