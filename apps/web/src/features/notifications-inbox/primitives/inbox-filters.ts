import { createSignal } from 'solid-js';
import {
  activeFilterCount,
  DEFAULT_INBOX_FILTERS,
  type InboxCategory,
  type InboxFilters,
  type InboxStatus,
  parseInboxFilters,
  rowTypesFor,
  statusIncludes,
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
  // Opening a row reads it, and it shouldn't vanish from Unread while the reader
  // is on it or its stack. It leaves when they next choose All or Unread.
  const [readHere, setReadHere] = createSignal<ReadonlySet<string>>(new Set());

  return {
    filters,
    rowTypes: () => rowTypesFor(filters()),
    activeCount: () => activeFilterCount(filters()),
    isShown: (category: InboxCategory) =>
      !filters().hiddenCategories.includes(category),
    /** Every category is hidden, so nothing can show. */
    showsNothing: () => rowTypesFor(filters()).length === 0,
    /** Whether a row shows under the chosen read state. */
    includesRow: (row: { id: string; unseen: boolean }) =>
      statusIncludes(filters().status, row.unseen) || readHere().has(row.id),
    /** Keep a row the reader just read showing until they next switch. */
    keepRead: (rowId: string) =>
      setReadHere((kept) => new Set(kept).add(rowId)),
    setStatus: (status: InboxStatus) => {
      setReadHere(new Set<string>());
      save({ ...filters(), status });
    },
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
