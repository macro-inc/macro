import { createSignal } from 'solid-js';
import {
  activeFilterCount,
  DEFAULT_INBOX_FILTERS,
  type InboxCategory,
  type InboxFilters,
  type InboxLane,
  type InboxStatus,
  parseInboxFilters,
  rowTypesFor,
  serializeInboxFilters,
} from '../core/inbox-filters';

/**
 * The reader's inbox filters. The read state and hidden kinds are kept in
 * `storage` between visits; the lane starts at `initialLane` every time.
 */
export function createInboxFilters(
  storage: {
    read: () => string | null;
    write: (value: string) => void;
  },
  initialLane: InboxLane = 'signal'
) {
  const [filters, setFilters] = createSignal<InboxFilters>({
    ...parseInboxFilters(storage.read()),
    lane: initialLane,
  });
  const save = (next: InboxFilters) => {
    setFilters(next);
    storage.write(serializeInboxFilters(next));
  };

  return {
    filters,
    rowTypes: () => rowTypesFor(filters()),
    activeCount: () => activeFilterCount(filters()),
    isShown: (category: InboxCategory) =>
      !filters().hiddenCategories.includes(category),
    /** Every category is hidden, so nothing can show. */
    showsNothing: () => rowTypesFor(filters()).length === 0,
    /**
     * The rows the feed reads: this lane, these kinds, and only unread ones
     * under Unread.
     */
    scope: () => ({
      lane: filters().lane,
      rowTypes: rowTypesFor(filters()),
      unreadOnly: filters().status === 'unread',
    }),
    setLane: (lane: InboxLane) => setFilters({ ...filters(), lane }),
    setStatus: (status: InboxStatus) => save({ ...filters(), status }),
    setShown: (category: InboxCategory, shown: boolean) => {
      const hidden = filters().hiddenCategories.filter(
        (hiddenCategory) => hiddenCategory !== category
      );
      save({
        ...filters(),
        hiddenCategories: shown ? hidden : [...hidden, category],
      });
    },
    /** Show every kind again; the All and Unread choice stays. */
    reset: () =>
      save({
        ...filters(),
        hiddenCategories: DEFAULT_INBOX_FILTERS.hiddenCategories,
      }),
  };
}
