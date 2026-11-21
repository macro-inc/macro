export type Summary = {
  n: number;
  median: number;
  p90: number;
  min: number;
  max: number;
  /** Median absolute deviation, scaled to estimate a standard deviation. */
  robustSd: number;
  /**
   * The smallest difference between two runs' medians of `n` samples each
   * that this spread lets the harness detect (95% confidence, 80% power).
   */
  detectableChange: number;
};

/** Linear-interpolated quantile of sorted values, q in [0, 1]. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * The median's standard error is about 1.2533 σ/√n for normal noise; a
 * difference of two medians has √2 times that, and detecting it at 95%
 * confidence with 80% power takes (1.96 + 0.84) standard errors.
 */
const DETECTABLE_FACTOR = (1.96 + 0.84) * Math.SQRT2 * 1.2533;

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((a, b) => a - b);
  const robustSd = 1.4826 * quantile(deviations, 0.5);
  return {
    n: sorted.length,
    median,
    p90: quantile(sorted, 0.9),
    min: sorted[0] ?? Number.NaN,
    max: sorted.at(-1) ?? Number.NaN,
    robustSd,
    detectableChange:
      sorted.length === 0
        ? Number.NaN
        : (DETECTABLE_FACTOR * robustSd) / Math.sqrt(sorted.length),
  };
}
