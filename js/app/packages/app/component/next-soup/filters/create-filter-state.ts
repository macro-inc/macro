import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { FilterAst } from './define-filter';

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

export type FilterStateOptions<T, TFilter extends FilterConfig<T, string>> = {
  readonly filters: readonly TFilter[];
  readonly groups?: readonly FilterGroupConfig[];
  readonly initialFilters?: readonly string[];
};

export type FilterState<
  T,
  TFilter extends FilterConfig<T, string>,
  TId extends string = TFilter['id'],
> = {
  readonly active: Accessor<readonly TFilter[]>;
  readonly activeIds: Accessor<readonly TId[]>;
  readonly isActive: (id: FilterIdInput<TId>) => boolean;
  readonly clear: () => void;
  readonly toggle: (ids: readonly FilterIdInput<TId>[]) => void;
  readonly set: (ids: readonly FilterIdInput<TId>[]) => void;
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
    initialFilters = [],
  } = options;

  const filterMap = new Map<string, TFilter>(
    availableFilters.map((f) => [f.id, f])
  );

  const groupMap = new Map<string, FilterGroupConfig>(
    groups.map((g) => [g.id, g])
  );

  const initialActiveFilters = initialFilters
    .map((id) => filterMap.get(id))
    .filter((f): f is TFilter => f !== undefined);

  const [activeFilters, setActiveFilters] =
    createSignal<readonly TFilter[]>(initialActiveFilters);

  const active = createMemo(() => activeFilters());
  const activeIds = createMemo(() => active().map((f) => f.id) as TId[]);

  const getFilter = (id: FilterIdInput<TId>): TFilter | undefined =>
    filterMap.get(id);

  const isActive = (id: FilterIdInput<TId>): boolean =>
    activeIds().includes(id as TId);

  const resolveFilters = (ids: readonly FilterIdInput<TId>[]): TFilter[] => {
    const resolved: TFilter[] = [];
    for (const id of ids) {
      const filter = getFilter(id);
      if (filter) resolved.push(filter);
    }
    return resolved;
  };

  const set = (ids: readonly FilterIdInput<TId>[]) => {
    setActiveFilters(resolveFilters(ids));
  };

  const toggle = (ids: readonly FilterIdInput<TId>[]) => {
    const toToggle = resolveFilters(ids);
    const current = activeFilters();

    let result = [...current];

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

    setActiveFilters(result);
  };

  const clear = () => {
    setActiveFilters([]);
  };

  const test = (entity: T): boolean => {
    const activeList = active();
    if (activeList.length === 0) return true;

    const byGroup = new Map<string | undefined, TFilter[]>();
    for (const filter of activeList) {
      const group = filter.group;
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(filter);
    }

    for (const [groupId, filters] of byGroup) {
      const groupConfig = groupId ? groupMap.get(groupId) : undefined;
      const allowMultiple = groupConfig?.allowMultiple ?? true;

      if (allowMultiple) {
        if (!filters.some((f) => f.predicate(entity))) return false;
      } else {
        if (!filters.every((f) => f.predicate(entity))) return false;
      }
    }

    return true;
  };

  return {
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
