import type { Backoff } from './backoff/backoff';

/**
 * Options for the websockets retry-strategy.
 */
export interface WebsocketConnectionRetryOptions {
  /**
   * The maximum number of retries before giving up. No limit if undefined.
   */
  readonly maxRetries?: number;

  /**
   * Wether to reconnect immediately after a connection has been lost,
   * ignoring the backoff strategy for the first retry.
   */
  readonly instantReconnect?: boolean;

  /**
   * The backoff strategy to use. This is used to determine the delay between connection-retries.
   */
  readonly backoff?: Backoff;
}
