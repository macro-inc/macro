import { Backoff } from './backoff';

/**
 * ConstantBackoff always returns the same backoff-time.
 */
export class ConstantBackoff implements Backoff {
  private readonly backoff: number;
  private _retries: number = 0;

  /**
   * Creates a new ConstantBackoff.
   * @param backoff the backoff-time to return
   */
  constructor(backoff: number) {
    if (!Number.isInteger(backoff) || backoff < 0) {
      throw new Error('Backoff must be a positive integer');
    }

    this.backoff = backoff;
  }

  get retries(): number {
    return this._retries;
  }

  get current(): number {
    return this.backoff;
  }

  next(): number {
    this._retries++;
    return this.backoff;
  }

  reset(): void {
    this._retries = 0;
  }
}
