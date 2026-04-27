import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { compileToAst, type TargetAstMap } from './compile';
import { addFieldValues, removeFieldValues } from './field-values';
import type { FieldFilters, QueryState, Query } from './types';

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

const mergeFields = (
  prev: FieldFilters,
  updates: FieldFilters | undefined
): FieldFilters => {
  if (!updates) return prev;
  const result: Record<string, unknown> = { ...prev };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result as FieldFilters;
};

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

  const replace = (query: Query | null) => {
    if (query === null) {
      setState(emptyQueryState());
      return;
    }
    setState({
      include: mergeFields({}, query.include),
      exclude: mergeFields({}, query.exclude),
      emailView: query.emailView,
    });
  };

  const set = (query: Query) => {
    batch(() => {
      if (query.include) {
        setState('include', (prev) => mergeFields(prev, query.include));
      }
      if (query.exclude) {
        setState('exclude', (prev) => mergeFields(prev, query.exclude));
      }
      if (query.emailView !== undefined) {
        setState('emailView', query.emailView);
      }
    });
  };

  const compile = (): TargetAstMap => compileToAst(state);

  return {
    state,
    set,
    replace,
    add,
    remove,
    compile,
  };
}

export type QueryStore = ReturnType<typeof createQueryStore>;
