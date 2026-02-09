import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { createMemo, createSignal, type Accessor } from 'solid-js';

/**
 * NIL UUID used to exclude an entity type from query results.
 *
 * Backend semantics:
 * - Empty array `[]` = "return all items of this type"
 * - `[NIL_UUID]` = "exclude this type entirely" (matches nothing)
 *
 * @example
 * ```ts
 * filters.set({
 *   query: {
 *     document_filters: { document_ids: [] },      // Include all docs
 *     chat_filters: { chat_ids: EXCLUDE },         // Exclude chats
 *   }
 * });
 * ```
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Array containing NIL_UUID, used to exclude an entity type from query results.
 *
 * @example
 * ```ts
 * filters.set({
 *   query: {
 *     chat_filters: { chat_ids: EXCLUDE },  // Exclude all chats
 *   }
 * });
 * ```
 */
export const EXCLUDE = [NIL_UUID] as const;

export type FilterPredicate<T> = (entity: T) => boolean;

export type FilterConfig<T> = {
  readonly id: string;
  readonly label: string;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
};

export type FiltersStateOptions<T, TConfig extends FilterConfig<T>> = {
  /** Available filter configs (e.g., SOUP_FILTERS) */
  configs: readonly TConfig[];
  /** Initial active predicate IDs */
  initialPredicates?: string[];
  /** Initial query filters */
  initialQuery?: SoupItemsQueryFilters;
};

export type FiltersState<T, TConfig extends FilterConfig<T>> = {
  /** Current active predicate IDs */
  predicates: Accessor<string[]>;

  /** Current query filters for API */
  query: Accessor<SoupItemsQueryFilters>;

  /** Full filter configs for active predicates (for UI rendering) */
  active: Accessor<TConfig[]>;

  /** Resolved predicate functions for active IDs */
  predicateFns: Accessor<Array<FilterPredicate<T>>>;

  /** All available filter configs */
  available: readonly TConfig[];

  /** Check if a predicate ID is active */
  isActive: (id: string) => boolean;

  /** Set predicates and/or query filters (replaces, does not merge) */
  set: (options: {
    predicates?: string[];
    query?: SoupItemsQueryFilters;
  }) => void;

  /** Toggle a predicate on/off by ID */
  toggle: (id: string) => void;

  /** Activate a predicate by ID (adds to active list if not already active) */
  activate: (id: string) => void;

  /** Deactivate a predicate by ID (removes from active list) */
  deactivate: (id: string) => void;

  /** Clear all predicates and query filters */
  clear: () => void;
};

export function createFiltersState<T, TConfig extends FilterConfig<T>>(
  options: FiltersStateOptions<T, TConfig>
): FiltersState<T, TConfig> {
  const { configs, initialPredicates = [], initialQuery = {} } = options;

  const configMap = new Map(configs.map((c) => [c.id, c]));

  const [activeIds, setActiveIds] = createSignal<string[]>(initialPredicates);
  const [queryFilters, setQueryFilters] =
    createSignal<SoupItemsQueryFilters>(initialQuery);

  const active = createMemo(() =>
    activeIds()
      .map((id) => configMap.get(id))
      .filter((c): c is TConfig => c !== undefined)
  );

  const predicateFns = createMemo(() => active().map((c) => c.predicate));

  const isActive = (id: string): boolean => activeIds().includes(id);

  const set = (opts: {
    predicates?: string[];
    query?: SoupItemsQueryFilters;
  }) => {
    if (opts.predicates !== undefined) {
      setActiveIds(opts.predicates);
    }
    if (opts.query !== undefined) {
      setQueryFilters(opts.query);
    }
  };

  const toggle = (id: string) => {
    if (isActive(id)) {
      setActiveIds((prev) => prev.filter((x) => x !== id));
    } else {
      setActiveIds((prev) => [...prev, id]);
    }
  };

  const activate = (id: string) => {
    if (!isActive(id)) {
      setActiveIds((prev) => [...prev, id]);
    }
  };

  const deactivate = (id: string) => {
    if (isActive(id)) {
      setActiveIds((prev) => prev.filter((x) => x !== id));
    }
  };

  const clear = () => {
    setActiveIds([]);
    setQueryFilters({});
  };

  return {
    predicates: activeIds,
    query: queryFilters,
    active,
    predicateFns,
    available: configs,
    isActive,
    set,
    toggle,
    activate,
    deactivate,
    clear,
  };
}
