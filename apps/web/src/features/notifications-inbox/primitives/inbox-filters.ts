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
  const saved = storage.read();
  const initial = parseInboxFilters(saved);
  const [filters, setFilters] = createSignal<InboxFilters>(initial);
  const serialized = JSON.stringify(initial);
  if (saved !== null && saved !== serialized) storage.write(serialized);
  const save = (next: InboxFilters) => {
    setFilters(next);
    storage.write(JSON.stringify(next));
  };

  return {
    filters,
    rowTypes: () => rowTypesFor(filters()),
    activeCount: () => activeFilterCount(filters()),
    isSelected: (category: InboxCategory) =>
      filters().selectedCategories.includes(category),
    isShown: (category: InboxCategory) =>
      filters().selectedCategories.length === 0 ||
      filters().selectedCategories.includes(category),
    /** The rows the feed reads: these kinds, and only unread ones under Unread. */
    scope: () => ({
      rowTypes: rowTypesFor(filters()),
      allKinds: filters().selectedCategories.length === 0,
      unreadOnly: filters().status === 'unread',
    }),
    setStatus: (status: InboxStatus) => save({ ...filters(), status }),
    setSelected: (category: InboxCategory, selected: boolean) => {
      const categories = filters().selectedCategories.filter(
        (selectedCategory) => selectedCategory !== category
      );
      save({
        ...filters(),
        selectedCategories: selected ? [...categories, category] : categories,
      });
    },
    /** Show every kind again; the All and Unread choice stays. */
    reset: () =>
      save({
        ...filters(),
        selectedCategories: DEFAULT_INBOX_FILTERS.selectedCategories,
      }),
  };
}
