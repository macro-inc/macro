import type { Client } from '@urql/core';

/** Query options accepted by the shared Solid observer adapter. */
export type ObserverClientOptions = {
  client?: Client;
};

/** Why an active urql execution reached its terminal lifecycle handler. */
export type ObserverEndReason = 'cancelled' | 'completed';

/** Observer contract consumed by the Solid base-query adapter. */
export type UrqlObserver<Options, Result extends object> = {
  /** Returns the observer's latest complete result snapshot. */
  getCurrentResult(): Result;
  /** Supplies the stable Solid result returned by the base adapter. */
  setReference?(result: Result): void;
  /** Applies reactive options or a replacement client. */
  setOptions(options: Options, client: Client): void;
  /** Subscribes to complete result snapshots. */
  subscribe(listener: (result: Result) => void): () => void;
  /** Releases all active urql subscriptions and pending actions. */
  destroy(): void;
};

/** Creates one query observer. */
export type UrqlObserverFactory<Options, Result extends object> = (
  client: Client,
  options: Options
) => UrqlObserver<Options, Result>;
