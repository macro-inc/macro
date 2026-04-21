import { createSignal, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { compileToAst, type TargetAstMap } from './compile';
import { addFieldValues, removeFieldValues } from './field-values';
import type {
  FilterConfig,
  FilterStoreOptions,
  FilterIdInput,
  SetFiltersInput,
  QueryState,
  Query,
} from './types';

export type {
  EmailView,
  PropertyFilter,
  FieldFilters,
  QueryState,
  Query,
  FilterPredicate,
  FilterConfig,
  FilterStoreOptions,
  SetFiltersInput,
} from './types';

export type { TargetAstMap } from './compile';

const emptyQueryState = (): QueryState => ({
  include: {},
  exclude: {},
  emailView: undefined,
});

export function createFilterStore<
  T,
  TFilter extends FilterConfig<T>,
  TId extends string = TFilter['id'],
>(options: FilterStoreOptions<T, TFilter, TId>) {
  const { filters: availableFilters, initialFilters = {} } = options;

  const filterMap = new Map<string, TFilter>(
    availableFilters.map((f) => [f.id, f])
  );

  const [andIds, setAndIds] = createSignal([...(initialFilters.and ?? [])]);

  const [orIds, setOrIds] = createSignal([...(initialFilters.or ?? [])]);

  const activeIds = createMemo(() => [...andIds(), ...orIds()]);

  const isActive = (id: FilterIdInput<TId>): boolean =>
    andIds().includes(id as TId) || orIds().includes(id as TId);

  const toggleIds = (ids: readonly FilterIdInput<TId>[], prev: TId[]) => {
    let result = prev;
    for (const id of ids) {
      const typedId = id as TId;
      if (result.includes(typedId)) {
        result = result.filter((i) => i !== id);
      } else if (filterMap.has(id)) {
        result = [...result, typedId];
      }
    }
    return result;
  };

  const toggle = (input: SetFiltersInput<TId>) => {
    if (input.and?.length) {
      setAndIds((prev) => toggleIds(input.and!, prev));
    }
    if (input.or?.length) {
      setOrIds((prev) => toggleIds(input.or!, prev));
    }
  };

  const setActiveFilters = (input: SetFiltersInput<TId>) => {
    const nextAnd = input.and?.filter((id) => filterMap.has(id));
    const nextOr = input.or?.filter((id) => filterMap.has(id));

    setAndIds((nextAnd ?? []) as TId[]);
    setOrIds((nextOr ?? []) as TId[]);
  };

  const clearFilters = () => {
    setAndIds([]);
    setOrIds([]);
  };

  const getFilter = (id: FilterIdInput<TId>): TFilter | undefined =>
    filterMap.get(id);

  const test = (entity: T, ctx?: unknown): boolean => {
    const andList = andIds();
    const orList = orIds();

    if (andList.length === 0 && orList.length === 0) return true;

    for (const id of andList) {
      const filter = filterMap.get(id);
      if (filter && !filter.predicate(entity, ctx)) return false;
    }

    if (orList.length > 0) {
      let anyMatch = false;
      for (const id of orList) {
        const filter = filterMap.get(id);
        if (filter?.predicate(entity, ctx)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) return false;
    }

    return true;
  };

  const [queryState, setQueryState] = createStore<QueryState>(
    emptyQueryState()
  );

  const addQuery = (query: Query | undefined) => {
    if (!query) return;
    setQueryState((prev) => ({
      include: addFieldValues(prev.include, query.include),
      exclude: addFieldValues(prev.exclude, query.exclude),
      emailView: query.emailView ?? prev.emailView,
    }));
  };

  const removeQuery = (query: Query | undefined) => {
    if (!query) return;
    setQueryState((prev) => ({
      include: removeFieldValues(prev.include, query.include),
      exclude: removeFieldValues(prev.exclude, query.exclude),
      emailView:
        query.emailView && prev.emailView === query.emailView
          ? undefined
          : prev.emailView,
    }));
  };

  const clearQuery = () => {
    setQueryState(emptyQueryState());
  };

  const compile = (): TargetAstMap => compileToAst(queryState);

  const clear = () => {
    clearFilters();
    clearQuery();
  };

  return {
    predicates: {
      andIds,
      orIds,
      activeIds,
      isActive,
      toggle,
      set: setActiveFilters,
      clear: clearFilters,
      getFilter,
      available: availableFilters,
      test,
    },

    query: {
      state: queryState,
      add: addQuery,
      remove: removeQuery,
      clear: clearQuery,
      compile,
    },

    clear,
  };
}
