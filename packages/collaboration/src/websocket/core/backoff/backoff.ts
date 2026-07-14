/**
 * A Backoff produces a series of numbers that are used to determine
 * the delay between connection-retries. Values are expected to be in milliseconds.
 */
export interface Backoff {
  /**
   * The number of retries. Starts at 0, increases by 1 for each call to next(). Resets to 0 when reset() is called.
   */
  readonly retries: number;

  /**
   * Current number in the series.
   */
  readonly current: number;

  /**
   * Advances the series to the next number and returns it.
   * @return the next number in the series
   */
  next(): number;

  /**
   * Resets the series to its initial state.
   */
  reset(): void;
}
