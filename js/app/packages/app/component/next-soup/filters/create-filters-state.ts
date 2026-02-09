import { createMemo, createSignal, type Accessor } from 'solid-js';

/** Filter predicate function */
export type FilterPredicate<T> = (entity: T, ...args: unknown[]) => boolean;

/** Filter configuration */
export type FilterConfig<T> = {
  readonly id: string;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
};

/** Options for creating filter state */
export type CreateFilterStateOptions<T, TFilter extends FilterConfig<T>> = {
  /** All available filter configurations */
  readonly filters: readonly TFilter[];
  /** Initial active filter IDs */
  readonly initialFilters?: readonly string[];
  /** Callback when filters change */
  readonly onChange?: (filters: TFilter[]) => void;
};

/** Filter state return type */
export type FilterState<T, TFilter extends FilterConfig<T>> = {
  /** Currently active filter configs */
  readonly active: Accessor<TFilter[]>;
  /** IDs of currently active filters */
  readonly activeIds: Accessor<string[]>;
  /** Check if a filter is active by ID */
  readonly isActive: (id: string) => boolean;
  /** Toggle a filter on/off */
  readonly toggle: (id: string) => void;
  /** Set a filter as active (respecting group exclusivity) */
  readonly activate: (id: string) => void;
  /** Remove a filter from active filters */
  readonly deactivate: (id: string) => void;
  /** Clear all active filters */
  readonly clear: () => void;
  /** Set filters directly */
  readonly set: (filters: TFilter[]) => void;
  /** Get a filter config by ID */
  readonly getFilter: (id: string) => TFilter | undefined;
  /** All available filter configs */
  readonly available: readonly TFilter[];
};

export function createFilterState<T, TFilter extends FilterConfig<T>>(
  options: CreateFilterStateOptions<T, TFilter>
): FilterState<T, TFilter> {
  const { filters: availableFilters, initialFilters = [], onChange } = options;

  // Create a lookup map for O(1) filter retrieval
  const filterMap = new Map<string, TFilter>(
    availableFilters.map((f) => [f.id, f])
  );

  // Initialize with initial filters
  const initialActiveFilters = initialFilters
    .map((id) => filterMap.get(id))
    .filter((f): f is TFilter => f !== undefined);

  const [activeFilters, setActiveFilters] =
    createSignal<TFilter[]>(initialActiveFilters);

  // Computed: active filter IDs
  const activeIds = createMemo(() => activeFilters().map((f) => f.id));

  // Helper: get filter by ID
  const getFilter = (id: string): TFilter | undefined => filterMap.get(id);

  // Helper: check if filter is active
  const isActive = (id: string): boolean => activeIds().includes(id);

  // Helper: update filters with onChange callback
  const updateFilters = (next: TFilter[]) => {
    setActiveFilters(next);
    onChange?.(next);
  };

  // Activate a filter (respecting group exclusivity)
  const activate = (id: string) => {
    const config = getFilter(id);
    if (!config) {
      console.warn(`Filter not found: ${id}`);
      return;
    }

    // Already active, nothing to do
    if (isActive(id)) return;

    const current = activeFilters();

    // If filter has a group, remove other filters in same group
    if (config.group) {
      const withoutSameGroup = current.filter((f) => f.group !== config.group);
      updateFilters([...withoutSameGroup, config]);
    } else {
      // No group, just add
      updateFilters([...current, config]);
    }
  };

  // Deactivate a filter
  const deactivate = (id: string) => {
    if (!isActive(id)) return;
    updateFilters(activeFilters().filter((f) => f.id !== id));
  };

  // Toggle a filter on/off
  const toggle = (id: string) => {
    if (isActive(id)) {
      deactivate(id);
    } else {
      activate(id);
    }
  };

  // Clear all filters
  const clear = () => {
    updateFilters([]);
  };

  // Set filters directly
  const set = (filters: TFilter[]) => {
    updateFilters(filters);
  };

  return {
    active: activeFilters,
    activeIds,
    isActive,
    toggle,
    activate,
    deactivate,
    clear,
    set,
    getFilter,
    available: availableFilters,
  };
}
