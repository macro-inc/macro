import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { compileToAst, type TargetAstMap } from './compile';
import { addFieldValues, removeFieldValues } from './field-values';
import type { FieldFilters, Query, QueryState } from './types';

export type { Query } from './types';

type QueryStoreOptions = {
  readonly initial?: Query;
};

const emptyQueryState = (): QueryState => ({
  include: {},
  exclude: {},
  emailView: undefined,
});

// For replace(): produces the full next fields object, dropping keys whose
// value is undefined or an empty array. Paired with reconcile() so the
// dropped keys are actually gone from the store.
const compactedFields = (
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

// For set(): produces a partial update where cleared values are encoded as
// `undefined`. Solid's store merge removes keys set to undefined; an object
// that just *omits* the key would leave the old value behind.
const partialFieldUpdate = (updates: FieldFilters): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      out[key] = undefined;
    } else {
      out[key] = value;
    }
  }
  return out;
};

export const mergeQuery = (base: QueryState, query: Query): QueryState => ({
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
      setState(reconcile(emptyQueryState()));
      return;
    }
    setState(
      reconcile({
        include: compactedFields({}, query.include),
        exclude: compactedFields({}, query.exclude),
        emailView: query.emailView,
      })
    );
  };

  const set = (query: Query) => {
    batch(() => {
      if (query.include) {
        setState('include', partialFieldUpdate(query.include));
      }
      if (query.exclude) {
        setState('exclude', partialFieldUpdate(query.exclude));
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
