import {
  createSearchParams,
  createSearchParamsCodec,
  type SerializedSearchParams,
} from '@app/lib/split-router';
import { z } from 'zod';
import { type InboxLane, laneOfVisit } from './core/inbox-filters';
import type { InboxLaneLocation } from './primitives/inbox-filters';
import type {
  InboxShownRow,
  InboxShownRowLocation,
} from './primitives/inbox-selection';

/** The lane a reader chose on a visit; empty when they have not chosen one. */
export type InboxChosenLane = InboxLane | '';

type InboxSearch = InboxShownRow & { lane: InboxChosenLane };

const INBOX_SEARCH_DEFAULTS: InboxSearch = { row: '', item: '', lane: '' };

/**
 * The row the Notifications preview shows, so each one opened is a history
 * entry, and the lane the reader chose, so Back from an opened row returns to
 * it.
 */
export const inboxSearch = {
  namespace: 'inbox',
  schema: z.object({
    row: z.string(),
    item: z.string(),
    lane: z.enum(['', 'signal', 'noise']),
  }),
  defaults: INBOX_SEARCH_DEFAULTS,
};

const inboxSearchCodec = createSearchParamsCodec(inboxSearch);

/**
 * The search naming `shown`, for a navigation that also leaves or opens the
 * Calendar. It carries the lane the reader chose, and none when they chose
 * none, so a visit that never left Signal keeps the URL it always had.
 */
export function inboxSearchFor(
  shown: InboxShownRow,
  lane: InboxChosenLane
): Record<string, SerializedSearchParams | undefined> {
  return {
    [inboxSearch.namespace]: inboxSearchCodec.serialize({ ...shown, lane }),
  };
}

/**
 * Keeps the lane in the Notifications URL, replacing the current entry: a
 * fresh visit opens in Signal, or in the lane of the row a link shows, and
 * Back from a row opened in Noise returns to Noise.
 */
export function useInboxLaneLocation(): InboxLaneLocation & {
  /** The lane as the URL holds it, to carry into another navigation. */
  chosen: () => InboxChosenLane;
} {
  const [search, setSearch] = createSearchParams(inboxSearch);

  return {
    lane: () => laneOfVisit(search.lane || undefined, search.row),
    setLane: (lane) => setSearch({ lane }, { history: 'replace' }),
    chosen: () => search.lane,
  };
}

/**
 * Keeps the shown row in the Notifications URL. Leaving an open Calendar for
 * another row, or for the list, is a single entry.
 */
export function useInboxShownRowLocation(calendar: {
  isOpen: () => boolean;
  close: (navigation: {
    search: Record<string, SerializedSearchParams | undefined>;
    replace: boolean;
  }) => void;
}): InboxShownRowLocation {
  const [search, setSearch] = createSearchParams(inboxSearch);

  return {
    shown: () => ({ row: search.row, item: search.item }),
    show: (next, { replace }) => {
      if (calendar.isOpen()) {
        calendar.close({
          search: inboxSearchFor(next, search.lane),
          replace,
        });
        return;
      }
      setSearch(next, { history: replace ? 'replace' : 'push' });
    },
  };
}
