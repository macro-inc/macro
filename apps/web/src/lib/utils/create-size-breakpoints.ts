import { type Accessor, createMemo } from 'solid-js';

/**
 * Inclusive size range. At least one bound is required.
 * - `max` alone — size ≤ max (same as the number shorthand)
 * - `min` alone — size ≥ min
 * - both — min ≤ size ≤ max
 */
export type BreakpointRange = {
  min?: number;
  max?: number;
};

/**
 * A breakpoint threshold: max-width shorthand, or an explicit min/max range.
 * `720` is equivalent to `{ max: 720 }`.
 */
export type BreakpointThreshold = number | BreakpointRange;

export type BreakpointThresholds = Record<string, BreakpointThreshold>;

/**
 * Reactive breakpoint accessors.
 *
 * Unmeasured size matches nothing, so first paint does not flash compact UI.
 */
export type Breakpoints<T extends BreakpointThresholds> = {
  [K in keyof T]-?: Accessor<boolean>;
};

export type BreakpointAccessors = Record<string, Accessor<boolean> | undefined>;

export function resolveBreakpointRange(threshold: BreakpointThreshold): {
  min?: number;
  max?: number;
} {
  if (typeof threshold === 'number') return { max: threshold };
  return threshold;
}

export function matchesBreakpoint(
  size: number | undefined,
  threshold: BreakpointThreshold
): boolean {
  if (size === undefined) return false;
  const range = resolveBreakpointRange(threshold);
  if (range.min !== undefined && size < range.min) return false;
  if (range.max !== undefined && size > range.max) return false;
  return range.min !== undefined || range.max !== undefined;
}

function assertBound(label: string, key: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Breakpoint "${key}" ${label} must be a non-negative finite number`
    );
  }
}

export function assertBreakpointThreshold(
  key: string,
  threshold: BreakpointThreshold
): void {
  if (typeof threshold === 'number') {
    assertBound('threshold', key, threshold);
    return;
  }

  const { min, max } = threshold;
  if (min === undefined && max === undefined) {
    throw new Error(`Breakpoint "${key}" must define min, max, or both`);
  }
  if (min !== undefined) assertBound('min', key, min);
  if (max !== undefined) assertBound('max', key, max);
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`Breakpoint "${key}" min (${min}) must be ≤ max (${max})`);
  }
}

/**
 * Creates keyed reactive breakpoints for an arbitrary size accessor.
 *
 * Unlike media-query breakpoints, these match the supplied size rather than
 * the browser viewport. Threshold values may change reactively; keys are fixed
 * from the initial threshold record.
 */
export function createSizeBreakpoints<const T extends BreakpointThresholds>(
  size: Accessor<number | undefined>,
  thresholds: T | Accessor<T>
): Breakpoints<T> {
  const getThresholds: Accessor<T> =
    typeof thresholds === 'function' ? thresholds : () => thresholds;
  const result = {} as Breakpoints<T>;
  const initialThresholds = getThresholds();

  for (const key of Object.keys(initialThresholds) as Array<keyof T & string>) {
    assertBreakpointThreshold(key, initialThresholds[key]);
    result[key] = createMemo(() => {
      const currentThreshold = getThresholds()[key];
      if (currentThreshold === undefined) return false;
      assertBreakpointThreshold(key, currentThreshold);
      return matchesBreakpoint(size(), currentThreshold);
    });
  }

  return result;
}
