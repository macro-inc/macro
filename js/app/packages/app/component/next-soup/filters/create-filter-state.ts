import { createMemo, createSignal, type Accessor } from 'solid-js';

export type FilterPredicate<T> = (entity: T) => boolean;

export type FilterConfig<T, TId extends string = string> = {
  readonly id: TId;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
};

export type FilterGroupConfig = {
  readonly id: string;
  readonly allowMultiple?: boolean;
};

type FilterIdInput<TId extends string> = TId | (string & {});

export type SetFiltersInput<
  TFilter extends FilterConfig<unknown>,
  TId extends string = TFilter['id'],
> = {
  /** Filters that must ALL pass (AND logic) */
  readonly and?: readonly (TFilter | FilterIdInput<TId>)[];
  /** Filters where ANY must pass (OR logic) */
  readonly or?: readonly (TFilter | FilterIdInput<TId>)[];
};

export type CurrentFilterState<TId extends string> = {
  readonly andIds: readonly TId[];
  readonly orIds: readonly TId[];
};

/**
 * Callback function for updating filters based on current state.
 */
export type SetFiltersCallback<
  TFilter extends FilterConfig<unknown>,
  TId extends string,
> = (current: CurrentFilterState<TId>) => SetFiltersInput<TFilter, TId>;

/** Internal representation of active filters */
type ActiveFiltersState<TFilter> = {
  readonly andFilters: readonly TFilter[];
  readonly orFilters: readonly TFilter[];
};

export type FilterStateOptions<T, TFilter extends FilterConfig<T, string>> = {
  /** All available filter configurations */
  readonly filters: readonly TFilter[];
  /** Filter group configurations for controlling mutual exclusivity */
  readonly groups?: readonly FilterGroupConfig[];
  /** Initial active filter IDs (applied as AND filters) */
  readonly initialFilters?: readonly string[];
};

export type FilterState<
  T,
  TFilter extends FilterConfig<T, string>,
  TId extends string = TFilter['id'],
> = {
  /** Currently active AND filter configs */
  readonly andFilters: Accessor<readonly TFilter[]>;
  /** Currently active OR filter configs */
  readonly orFilters: Accessor<readonly TFilter[]>;
  /** All currently active filter configs (both AND and OR) */
  readonly active: Accessor<readonly TFilter[]>;
  /** IDs of currently active filters */
  readonly activeIds: Accessor<readonly TId[]>;
  /** Check if a filter is active by ID */
  readonly isActive: (id: FilterIdInput<TId>) => boolean;
  /** Clear all active filters */
  readonly clear: () => void;
  /** Toggle filters on/off. Respects group exclusivity. */
  readonly toggle: (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => void;
  /** Set filters with explicit AND/OR grouping. Replaces all current filters. */
  readonly set: (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => void;
  /** Get a filter config by ID */
  readonly getFilter: (id: FilterIdInput<TId>) => TFilter | undefined;
  /** All available filter configs */
  readonly available: readonly TFilter[];
  /** Test if an entity passes the active filters. */
  readonly test: (entity: T) => boolean;
};

export function createFilterState<
  T,
  TFilter extends FilterConfig<T>,
  TId extends string = TFilter['id'],
>(options: FilterStateOptions<T, TFilter>): FilterState<T, TFilter, TId> {
  const {
    filters: availableFilters,
    groups = [],
    initialFilters = [],
  } = options;

  const filterMap = new Map<string, TFilter>(
    availableFilters.map((f) => [f.id, f])
  );

  const groupMap = new Map<string, FilterGroupConfig>(
    groups.map((g) => [g.id, g])
  );

  // Initialize with initial filters (as AND filters)
  const initialAndFilters = initialFilters
    .map((id) => filterMap.get(id))
    .filter((f): f is TFilter => f !== undefined);

  const [state, setState] = createSignal<ActiveFiltersState<TFilter>>({
    andFilters: initialAndFilters,
    orFilters: [],
  });

  const andFilters = createMemo(() => state().andFilters);
  const orFilters = createMemo(() => state().orFilters);

  const active = createMemo(() => [
    ...state().andFilters,
    ...state().orFilters,
  ]);
  const activeIds = createMemo(() => active().map((f) => f.id) as TId[]);

  const getFilter = (id: FilterIdInput<TId>): TFilter | undefined =>
    filterMap.get(id);

  const isActive = (id: FilterIdInput<TId>): boolean =>
    activeIds().includes(id as TId);

  const resolveFilters = (
    input: readonly (TFilter | FilterIdInput<TId>)[] | undefined
  ): TFilter[] => {
    if (!input) return [];

    const resolved: TFilter[] = [];
    for (const item of input) {
      if (typeof item === 'string') {
        const filter = getFilter(item);
        if (filter) resolved.push(filter);
      } else {
        resolved.push(item);
      }
    }
    return resolved;
  };

  const set = (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => {
    const resolved =
      typeof input === 'function'
        ? input({
            andIds: state().andFilters.map((f) => f.id) as TId[],
            orIds: state().orFilters.map((f) => f.id) as TId[],
          })
        : input;

    const newState: ActiveFiltersState<TFilter> = {
      andFilters: resolveFilters(resolved.and),
      orFilters: resolveFilters(resolved.or),
    };
    setState(newState);
  };

  const toggleFilters = (
    currentFilters: readonly TFilter[],
    toToggle: readonly TFilter[]
  ): TFilter[] => {
    let result = [...currentFilters];

    for (const filter of toToggle) {
      const isCurrentlyActive = result.some((f) => f.id === filter.id);

      if (isCurrentlyActive) {
        // Deactivate
        result = result.filter((f) => f.id !== filter.id);
      } else {
        // Activate - handle group exclusivity based on allowMultiple
        if (filter.group) {
          const groupConfig = groupMap.get(filter.group);
          const allowMultiple = groupConfig?.allowMultiple ?? false;

          if (!allowMultiple) {
            // Remove other filters in the same group
            result = result.filter((f) => f.group !== filter.group);
          }
        }
        result.push(filter);
      }
    }

    return result;
  };

  const toggle = (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => {
    const resolved =
      typeof input === 'function'
        ? input({
            andIds: state().andFilters.map((f) => f.id) as TId[],
            orIds: state().orFilters.map((f) => f.id) as TId[],
          })
        : input;

    const andToToggle = resolveFilters(resolved.and);
    const orToToggle = resolveFilters(resolved.or);

    const current = state();

    setState({
      andFilters: toggleFilters(current.andFilters, andToToggle),
      orFilters: toggleFilters(current.orFilters, orToToggle),
    });
  };

  const clear = () => {
    setState({
      andFilters: [],
      orFilters: [],
    });
  };

  const test = (entity: T): boolean => {
    const { andFilters: andList, orFilters: orList } = state();

    // If no filters are active, everything passes
    if (andList.length === 0 && orList.length === 0) {
      return true;
    }

    // All AND filters must pass
    if (andList.length > 0) {
      const passesAnd = andList.every((f) => f.predicate(entity));
      if (!passesAnd) return false;
    }

    // At least one OR filter must pass (if any OR filters are active)
    if (orList.length > 0) {
      const passesOr = orList.some((f) => f.predicate(entity));
      if (!passesOr) return false;
    }

    return true;
  };

  return {
    andFilters,
    orFilters,
    active,
    activeIds,
    isActive,
    toggle,
    clear,
    set,
    getFilter,
    available: availableFilters,
    test,
  };
}
