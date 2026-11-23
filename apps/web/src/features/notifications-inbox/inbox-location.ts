import {
  createSearchParams,
  createSearchParamsCodec,
  type SerializedSearchParams,
} from '@app/lib/split-router';
import { z } from 'zod';
import type {
  InboxShownRow,
  InboxShownRowLocation,
} from './primitives/inbox-selection';

/** The row the Notifications preview shows, so each one opened is a history entry. */
export const inboxSearch = {
  namespace: 'inbox',
  schema: z.object({ row: z.string(), item: z.string() }),
  defaults: { row: '', item: '' },
};

const inboxSearchCodec = createSearchParamsCodec(inboxSearch);

/** The search naming `shown`, for a navigation that also leaves or opens the Calendar. */
export function inboxSearchFor(
  shown: InboxShownRow
): Record<string, SerializedSearchParams | undefined> {
  return { [inboxSearch.namespace]: inboxSearchCodec.serialize(shown) };
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
        calendar.close({ search: inboxSearchFor(next), replace });
        return;
      }
      setSearch(next, { history: replace ? 'replace' : 'push' });
    },
  };
}
