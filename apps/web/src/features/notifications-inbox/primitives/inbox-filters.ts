import { createSignal } from 'solid-js';
import {
  activeFilterCount,
  DEFAULT_INBOX_FILTERS,
  type InboxCategory,
  type InboxFilters,
  type InboxStatus,
  parseInboxFilters,
  rowTypesFor,
} from '../core/inbox-filters';

/** The reader's inbox filters, kept in `storage` between visits. */
export function createInboxFilters(storage: {
  read: () => string | null;
  write: (value: string) => void;
}) {
  const [filters, setFilters] = createSignal<InboxFilters>(
    parseInboxFilters(storage.read())
  );
  const save = (next: InboxFilters) => {
    setFilters(next);
    storage.write(JSON.stringify(next));
  };

  return {
    filters,
    rowTypes: () => rowTypesFor(filters()),
    activeCount: () => activeFilterCount(filters()),
    isShown: (category: InboxCategory) =>
      !filters().hiddenCategories.includes(category),
    /** Every category is hidden, so nothing can show. */
    showsNothing: () => rowTypesFor(filters()).length === 0,
    /** The rows the feed reads: these kinds, and only unread ones under Unread. */
    scope: () => ({
      rowTypes: rowTypesFor(filters()),
      unreadOnly: filters().status === 'unread',
    }),
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
