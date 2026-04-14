import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { AstBucket, FilterAst } from './define-filter';

export type FilterPredicate<T> = (entity: T) => boolean;

export type FilterConfig<T, TId extends string = string> = {
  readonly id: TId;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
  /** Optional AST for server-side filtering */
  readonly ast?: FilterAst | ((ctx: unknown) => FilterAst);
};

export type FilterGroupConfig = {
  readonly id: string;
  readonly allowMultiple?: boolean;
};

type FilterIdInput<TId extends string> = TId | (string & {});

/** Filter ID with optional target scope for AST generation */
export type ScopedFilterId<TId extends string = string> =
  | FilterIdInput<TId>
  | { id: FilterIdInput<TId>; targets: AstBucket[] };

export type SetFiltersInput<TId extends string = string> = {
  /** Filters that must ALL pass (AND logic) - typically from presets */
  readonly and?: readonly ScopedFilterId<TId>[];
  /** Filters where ANY must pass (OR logic) - typically from user selection */
  readonly or?: readonly ScopedFilterId<TId>[];
};

export type CurrentFilterState<TId extends string> = {
  readonly andIds: readonly TId[];
  readonly orIds: readonly TId[];
};

/**
 * Callback function for updating filters based on current state.
 */
export type SetFiltersCallback<TId extends string> = (
  current: CurrentFilterState<TId>
) => SetFiltersInput<TId>;

/** Internal representation of a filter with optional scope */
type ScopedFilter<TFilter> = {
  readonly filter: TFilter;
  readonly targets?: AstBucket[];
};

/** Internal representation of active filters */
type ActiveFiltersState<TFilter> = {
  readonly andFilters: readonly ScopedFilter<TFilter>[];
  readonly orFilters: readonly ScopedFilter<TFilter>[];
};

export type FilterStateOptions<T, TFilter extends FilterConfig<T, string>> = {
  /** All available filter configurations */
  readonly filters: readonly TFilter[];
  /** Filter group configurations for controlling mutual exclusivity */
  readonly groups?: readonly FilterGroupConfig[];
  /** Initial active filter IDs (applied as AND filters) */
  readonly initialFilters?: SetFiltersInput<string>;
};

/** A filter with its optional scope for AST generation */
export type ScopedFilterEntry<TFilter> = {
  readonly filter: TFilter;
  readonly targets?: AstBucket[];
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
  /** AND filters with their scope information for AST generation */
  readonly andFiltersWithScope: Accessor<readonly ScopedFilterEntry<TFilter>[]>;
  /** OR filters with their scope information for AST generation */
  readonly orFiltersWithScope: Accessor<readonly ScopedFilterEntry<TFilter>[]>;
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
    input: SetFiltersInput<TId> | SetFiltersCallback<TId>
  ) => void;
  /** Set filters with explicit AND/OR grouping. Replaces all current filters. */
  readonly set: (input: SetFiltersInput<TId> | SetFiltersCallback<TId>) => void;
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
    initialFilters = {},
  } = options;

  const filterMap = new Map<string, TFilter>(
    availableFilters.map((f) => [f.id, f])
  );

  const groupMap = new Map<string, FilterGroupConfig>(
    groups.map((g) => [g.id, g])
  );

  const getFilter = (id: FilterIdInput<TId>): TFilter | undefined =>
    filterMap.get(id);

  /** Extract the ID from a scoped filter reference */
  const extractId = (input: ScopedFilterId<TId>): string =>
    typeof input === 'object' && 'id' in input
      ? String(input.id)
      : String(input);

  /** Extract the targets from a scoped filter reference */
  const extractTargets = (
    input: ScopedFilterId<TId>
  ): AstBucket[] | undefined =>
    typeof input === 'object' && 'targets' in input ? input.targets : undefined;

  /** Resolve scoped filter IDs to scoped filters */
  const resolveScopedFilters = (
    inputs: readonly ScopedFilterId<TId>[] | undefined
  ): ScopedFilter<TFilter>[] => {
    if (!inputs) return [];

    const resolved: ScopedFilter<TFilter>[] = [];
    for (const input of inputs) {
      const id = extractId(input);
      const filter = filterMap.get(id);
      if (filter) {
        resolved.push({
          filter,
          targets: extractTargets(input),
        });
      }
    }
    return resolved;
  };

  // Initialize with initial filters
  const initialAndFilters = resolveScopedFilters(
    initialFilters.and as ScopedFilterId<TId>[] | undefined
  );
  const initialOrFilters = resolveScopedFilters(
    initialFilters.or as ScopedFilterId<TId>[] | undefined
  );

  const [state, setState] = createSignal<ActiveFiltersState<TFilter>>({
    andFilters: initialAndFilters,
    orFilters: initialOrFilters,
  });

  const andFilters = createMemo(() => state().andFilters.map((s) => s.filter));
  const orFilters = createMemo(() => state().orFilters.map((s) => s.filter));

  const andFiltersWithScope = createMemo(() =>
    state().andFilters.map((s) => ({ filter: s.filter, targets: s.targets }))
  );
  const orFiltersWithScope = createMemo(() =>
    state().orFilters.map((s) => ({ filter: s.filter, targets: s.targets }))
  );

  const active = createMemo(() => [...andFilters(), ...orFilters()]);
  const activeIds = createMemo(() => active().map((f) => f.id) as TId[]);

  const isActive = (id: FilterIdInput<TId>): boolean =>
    activeIds().includes(id as TId);

  const set = (input: SetFiltersInput<TId> | SetFiltersCallback<TId>) => {
    const resolved =
      typeof input === 'function'
        ? input({
            andIds: andFilters().map((f) => f.id) as TId[],
            orIds: orFilters().map((f) => f.id) as TId[],
          })
        : input;

    setState({
      andFilters: resolveScopedFilters(resolved.and),
      orFilters: resolveScopedFilters(resolved.or),
    });
  };

  const toggleFilters = (
    currentFilters: readonly ScopedFilter<TFilter>[],
    toToggle: readonly ScopedFilter<TFilter>[]
  ): ScopedFilter<TFilter>[] => {
    let result = [...currentFilters];

    for (const scoped of toToggle) {
      const { filter } = scoped;
      const isCurrentlyActive = result.some((s) => s.filter.id === filter.id);

      if (isCurrentlyActive) {
        // Deactivate
        result = result.filter((s) => s.filter.id !== filter.id);
      } else {
        // Activate - handle group exclusivity based on allowMultiple
        if (filter.group) {
          const groupConfig = groupMap.get(filter.group);
          const allowMultiple = groupConfig?.allowMultiple ?? false;

          if (!allowMultiple) {
            // Remove other filters in the same group
            result = result.filter((s) => s.filter.group !== filter.group);
          }
        }
        result.push(scoped);
      }
    }

    return result;
  };

  const toggle = (input: SetFiltersInput<TId> | SetFiltersCallback<TId>) => {
    const resolved =
      typeof input === 'function'
        ? input({
            andIds: andFilters().map((f) => f.id) as TId[],
            orIds: orFilters().map((f) => f.id) as TId[],
          })
        : input;

    const andToToggle = resolveScopedFilters(resolved.and);
    const orToToggle = resolveScopedFilters(resolved.or);

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
    const andList = andFilters();
    const orList = orFilters();

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
    andFiltersWithScope,
    orFiltersWithScope,
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
