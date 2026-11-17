import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import type { AppEvents } from '@app/lib/analytics/app-events';
import { type Accessor, createEffect, on } from 'solid-js';
import type { EmailFocusSort } from './constants';

export type FocusTabVisit = {
  /** The Focus list is the one the view shows. */
  showing: Accessor<boolean>;
  /** The Focus read is in flight. */
  fetching: Accessor<boolean>;
  /** The latest Focus read failed. */
  failed: Accessor<boolean>;
  /** The rows are built from a Focus read. */
  loaded: Accessor<boolean>;
  /** Threads in the Focus list, before the view's filters and search. */
  threads: Accessor<number>;
  /** Threads the list shows. */
  rows: Accessor<number>;
  /** A search, filter or inbox choice hides some of the list. */
  narrowed: Accessor<boolean>;
  sort: Accessor<EmailFocusSort>;
};

/** Where a visit is: before its own read, during it, or done with. */
type VisitPhase = 'away' | 'arrived' | 'reading' | 'settled';

/**
 * Counts each visit to the Focus tab once, when the read the visit started
 * returns, so an empty tab reads as `rows: 0` and rows kept from an earlier
 * visit are never reported. A visit that ends before its read returns, or
 * whose read fails, is not counted. Coming back from a thread is the same
 * visit; leaving for another tab and returning is a new one.
 */
export function trackFocusTabVisits(
  visit: FocusTabVisit,
  track: (payload: AppEvents['email_focus_tab_opened']) => void
) {
  let phase: VisitPhase = 'away';
  createEffect(
    on(
      [visit.showing, visit.fetching, visit.loaded],
      ([showing, fetching, loaded]) => {
        if (!showing) {
          phase = 'away';
          return;
        }
        if (phase === 'away') phase = 'arrived';
        if (phase === 'arrived' && fetching) phase = 'reading';
        if (phase !== 'reading' || fetching || !loaded) return;
        phase = 'settled';
        if (visit.failed()) return;
        // Read untracked: a later change in the list is the same visit.
        track({
          rows: visit.rows(),
          threads: visit.threads(),
          narrowed: visit.narrowed(),
          sort: visit.sort(),
        });
      }
    )
  );
}

/** Facets the Focus list ignores (see `selectFocusEmails`). */
const IGNORED_FACETS = new Set(['read', 'done']);

/** Whether a search, filter or inbox choice hides part of the Focus list. */
export function isFocusListNarrowed(input: {
  search: string;
  inboxIds: readonly string[] | undefined;
  facets: FacetSelection;
  aliasFilter?: unknown;
}): boolean {
  return (
    input.search.trim() !== '' ||
    input.inboxIds !== undefined ||
    input.aliasFilter !== undefined ||
    Object.entries(input.facets).some(
      ([id, values]) => !IGNORED_FACETS.has(id) && values.length > 0
    )
  );
}
