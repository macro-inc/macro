/**
 * The single source of nondeterminism for animation: selection direction, pause
 * jitter, and sweep counts. Animators consume it through `integer`/`real` so the
 * ranges (queue params) stay declarative. The real source is backed by random-js
 * (unbiased rejection-sampled integers); the mock replays chosen values, making a
 * full `DocumentOpAction` deterministic and assertable.
 */
import { nativeMath, Random } from 'random-js';

export type Direction = 'left' | 'right';
export type Range = [min: number, max: number];

export interface RandomSource {
  /** Inclusive integer in [min, max], uniform. */
  integer(range: Range): number;
  /** Float in [min, max). */
  real(range: Range): number;
  /** Which end a drag-select anchors to. Biased 60/40 toward 'left'. */
  direction(): Direction;
}

/** Real source backed by random-js + Math.random. Tests use `mockRandomSource`. */
export function realRandomSource(): RandomSource {
  const random = new Random(nativeMath);
  return {
    integer: ([min, max]) => random.integer(min, max),
    real: ([min, max]) => random.real(min, max, false),
    direction: () => (random.bool(0.6) ? 'left' : 'right'),
  };
}

export type MockRandomOptions = {
  /** Constant, or a sequence consumed in order (throws when exhausted). */
  integer?: number | number[];
  real?: number | number[];
  direction?: Direction | Direction[];
};

/**
 * Replaying source. Each method ignores its range and returns chosen values:
 * pass a scalar for a constant (every call returns it) or an array for an exact
 * sequence (overflow throws, to catch under-specified tests). Defaults: integer
 * 0, real 0, direction 'left'.
 */
export function mockRandomSource(opts: MockRandomOptions = {}): RandomSource {
  const integer = drawer('integer', opts.integer, 0);
  const real = drawer('real', opts.real, 0);
  const direction = drawer<Direction>('direction', opts.direction, 'left');
  return {
    integer: () => integer(),
    real: () => real(),
    direction: () => direction(),
  };
}

function drawer<T>(
  label: string,
  value: T | T[] | undefined,
  fallback: T
): () => T {
  if (value === undefined) return () => fallback;
  if (!Array.isArray(value)) return () => value;
  let i = 0;
  return () => {
    if (i >= value.length)
      throw new Error(
        `mockRandomSource: ${label} sequence exhausted at draw ${i + 1}`
      );
    return value[i++]!;
  };
}
