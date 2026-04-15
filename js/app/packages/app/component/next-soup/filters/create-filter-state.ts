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
  readonly and?: readonly (TFilter | FilterIdInput<TId>)[];
  readonly or?: readonly (TFilter | FilterIdInput<TId>)[];
};

export type CurrentFilterState<TId extends string> = {
  readonly andIds: readonly TId[];
  readonly orIds: readonly TId[];
};

export type SetFiltersCallback<
  TFilter extends FilterConfig<unknown>,
  TId extends string,
> = (current: CurrentFilterState<TId>) => SetFiltersInput<TFilter, TId>;

type ActiveFiltersState<TFilter> = {
  readonly andFilters: readonly TFilter[];
  readonly orFilters: readonly TFilter[];
};

export type InitialFiltersInput = {
  readonly and?: readonly string[];
  readonly or?: readonly string[];
};

export type FilterStateOptions<T, TFilter extends FilterConfig<T, string>> = {
  readonly filters: readonly TFilter[];
  readonly groups?: readonly FilterGroupConfig[];
  readonly initialFilters?: InitialFiltersInput;
};

export type FilterState<
  T,
  TFilter extends FilterConfig<T, string>,
  TId extends string = TFilter['id'],
> = {
  readonly andFilters: Accessor<readonly TFilter[]>;
  readonly orFilters: Accessor<readonly TFilter[]>;
  readonly active: Accessor<readonly TFilter[]>;
  readonly activeIds: Accessor<readonly TId[]>;
  readonly isActive: (id: FilterIdInput<TId>) => boolean;
  readonly clear: () => void;
  readonly toggle: (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => void;
  readonly set: (
    input: SetFiltersInput<TFilter, TId> | SetFiltersCallback<TFilter, TId>
  ) => void;
  readonly getFilter: (id: FilterIdInput<TId>) => TFilter | undefined;
  readonly available: readonly TFilter[];
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

  const resolveInitialFilters = (ids: readonly string[] = []): TFilter[] =>
    ids
      .map((id) => filterMap.get(id))
      .filter((f): f is TFilter => f !== undefined);

  const [state, setState] = createSignal<ActiveFiltersState<TFilter>>({
    andFilters: resolveInitialFilters(initialFilters.and),
    orFilters: resolveInitialFilters(initialFilters.or),
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

    setState({
      andFilters: resolveFilters(resolved.and),
      orFilters: resolveFilters(resolved.or),
    });
  };

  const toggleFilters = (
    currentFilters: readonly TFilter[],
    toToggle: readonly TFilter[]
  ): TFilter[] => {
    let result = [...currentFilters];

    for (const filter of toToggle) {
      const isCurrentlyActive = result.some((f) => f.id === filter.id);

      if (isCurrentlyActive) {
        result = result.filter((f) => f.id !== filter.id);
      } else {
        if (filter.group) {
          const groupConfig = groupMap.get(filter.group);
          const allowMultiple = groupConfig?.allowMultiple ?? false;

          if (!allowMultiple) {
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

    if (andList.length === 0 && orList.length === 0) return true;

    if (andList.length > 0 && !andList.every((f) => f.predicate(entity))) {
      return false;
    }

    if (orList.length > 0 && !orList.some((f) => f.predicate(entity))) {
      return false;
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
