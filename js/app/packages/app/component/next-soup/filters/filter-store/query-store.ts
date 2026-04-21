import { createStore } from 'solid-js/store';
import { compileToAst, type TargetAstMap } from './compile';
import {
  addFieldValues,
  removeFieldValues,
  hasFieldValues,
} from './field-values';
import type { QueryState, Query } from './types';

export type { TargetAstMap } from './compile';
export type { FieldFilters, QueryState, Query, EmailView } from './types';

export type QueryStoreOptions = {
  readonly initial?: Query;
};

const emptyQueryState = (): QueryState => ({
  include: {},
  exclude: {},
  emailView: undefined,
});

const mergeQuery = (base: QueryState, query: Query): QueryState => ({
  include: addFieldValues(base.include, query.include),
  exclude: addFieldValues(base.exclude, query.exclude),
  emailView: query.emailView ?? base.emailView,
});

export function createQueryStore(options: QueryStoreOptions = {}) {
  const { initial } = options;

  const [state, setState] = createStore<QueryState>(
    initial ? mergeQuery(emptyQueryState(), initial) : emptyQueryState()
  );

  const add = (query: Query | undefined) => {
    if (!query) return;
    setState((prev) => mergeQuery(prev, query));
  };

  const remove = (query: Query | undefined) => {
    if (!query) return;
    setState((prev) => ({
      include: removeFieldValues(prev.include, query.include),
      exclude: removeFieldValues(prev.exclude, query.exclude),
      emailView:
        query.emailView && prev.emailView === query.emailView
          ? undefined
          : prev.emailView,
    }));
  };

  const clear = () => {
    setState(emptyQueryState());
  };

  const compile = (): TargetAstMap => compileToAst(state);

  const has = (query: Query | undefined): boolean => {
    if (!query) return false;

    const includeMatch = hasFieldValues(state.include, query.include);
    const excludeMatch = hasFieldValues(state.exclude, query.exclude);
    const emailViewMatch =
      !query.emailView || state.emailView === query.emailView;

    return includeMatch && excludeMatch && emailViewMatch;
  };

  return {
    state,
    set: setState,
    add,
    remove,
    has,
    clear,
    compile,
  };
}

export type QueryStore = ReturnType<typeof createQueryStore>;
