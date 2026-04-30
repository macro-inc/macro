import { type Accessor, createMemo, on } from 'solid-js';

type UseSelectedFirstOptions<T> = {
  /** Items currently visible (after search/filter). */
  items: Accessor<T[]>;
  /** Currently-selected ids. Read non-reactively — see `resortDeps`. */
  selectedIds: Accessor<Iterable<string>>;
  /** Active search/filter query. When non-empty, items are returned as-is. */
  searchQuery: Accessor<string>;
  /** Extracts a stable id from an item. */
  getId: (item: T) => string;
  /**
   * Optional pool of all available items. When `items` is sliced (e.g. top N
   * by recency), selected ids missing from `items` are looked up here so the
   * user can still see and toggle them off.
   */
  allItems?: Accessor<T[]>;
  /**
   * Reactive deps that, when changed, recompute the partition. The memo
   * deliberately does NOT track `selectedIds`, so toggling selection inside
   * an open menu doesn't shuffle items underneath the user. Pass an "is
   * open" accessor to re-sort each time the menu reopens.
   */
  sortDeps?: Accessor<unknown>[];
};

/**
 * Returns `items` with currently-selected entries pinned to the top. Used by
 * the task assignee menu and the In/From search filter menus: stable order
 * during a single open session, re-sorted on (re)open.
 */
export function useSelectedFirst<T>(
  opts: UseSelectedFirstOptions<T>
): Accessor<T[]> {
  return createMemo(
    on([opts.items, opts.searchQuery, ...(opts.sortDeps ?? [])], () => {
      const items = opts.items();
      if (opts.searchQuery()) return items;

      const idSet = new Set<string>();
      for (const id of opts.selectedIds()) idSet.add(id);
      if (idSet.size === 0) return items;

      const selected: T[] = [];
      const unselected: T[] = [];
      const visibleIds = new Set<string>();

      for (const item of items) {
        const id = opts.getId(item);
        visibleIds.add(id);
        if (idSet.has(id)) selected.push(item);
        else unselected.push(item);
      }

      const all = opts.allItems?.();
      if (all) {
        for (const id of idSet) {
          if (visibleIds.has(id)) continue;
          const found = all.find((it) => opts.getId(it) === id);
          if (found) selected.push(found);
        }
      }

      return [...selected, ...unselected];
    })
  );
}
