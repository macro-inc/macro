import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import type { AppEvents } from '@app/lib/analytics/app-events';
import { type Accessor, createEffect, on } from 'solid-js';
import type { EmailFocusSort } from './constants';

export type FocusTabVisit = {
  /** The Focus list is the one the view shows. */
  showing: Accessor<boolean>;
  /** The Focus read has returned and the rows are built from it. */
  loaded: Accessor<boolean>;
  /** Threads in the Focus list, before the view's filters and search. */
  threads: Accessor<number>;
  /** Threads the list shows. */
  rows: Accessor<number>;
  /** A search, filter or inbox choice hides some of the list. */
  narrowed: Accessor<boolean>;
  sort: Accessor<EmailFocusSort>;
};

/**
 * Counts each visit to the Focus tab once, when its list first shows, so an
 * empty tab reads as `rows: 0`. A visit that ends before the list loads, or
 * whose read fails, is not counted. Coming back from a thread is the same
 * visit; leaving for another tab and returning is a new one.
 */
export function trackFocusTabVisits(
  visit: FocusTabVisit,
  track: (payload: AppEvents['email_focus_tab_opened']) => void
) {
  let counted = false;
  createEffect(
    on([visit.showing, visit.loaded], ([showing, loaded]) => {
      if (!showing) {
        counted = false;
        return;
      }
      if (counted || !loaded) return;
      counted = true;
      // Read untracked: a later change in the list is the same visit.
      track({
        rows: visit.rows(),
        threads: visit.threads(),
        narrowed: visit.narrowed(),
        sort: visit.sort(),
      });
    })
  );
}

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
    Object.values(input.facets).some((values) => values.length > 0)
  );
}
