import type { ExternalLocation, WriteMode } from '../routes/types';
import type { MaybePromise } from '../utils';

export type ExternalChange = {
  location: ExternalLocation;
  /**
   * Put the host back where it was. Settles once it is: pane commands wait for
   * it, so writes after it apply to the entry it returns to. It must always settle.
   */
  revert(): MaybePromise<void>;
};

/**
 * Return false to stop the host applying a navigation it started. `location`
 * is undefined when the host is leaving the router's routes.
 */
export type InterceptHandler = (
  location: ExternalLocation | undefined
) => MaybePromise<boolean>;

/** Connects the router to whatever owns the real URL. */
export interface HistoryAdapter {
  read(): ExternalLocation;
  /** May apply later, or merge with other writes. */
  write(location: ExternalLocation, options: { mode: WriteMode }): void;
  /**
   * Location changes, in order. Reports may include this adapter's own writes
   * and reverts landing; the router ignores locations it already shows.
   */
  subscribe(listener: (change: ExternalChange) => void): () => void;
  /** A string for `<a href>` and copying, including base path and hash prefix. */
  href(location: Omit<ExternalLocation, 'state'>): string;
  intercept?(handler: InterceptHandler): () => void;
}
