import type { SetPredicatesInput } from '../filters/filter-store/predicates-store';
import type { Query } from '../filters/filter-store/query-store';

type ViewFilters = {
  query?: Query;
  predicates?: SetPredicatesInput<string>;
};

/** Resolve each destination independently: the split provider survives navigation. */
export function resolveInitialViewFilters(options: {
  entry: ViewFilters;
  persisted: ViewFilters;
  initial: ViewFilters;
  preferInitialFilters?: boolean;
}): ViewFilters {
  return {
    query:
      options.entry.query ??
      (options.preferInitialFilters ? options.initial.query : undefined) ??
      options.persisted.query ??
      options.initial.query,
    predicates:
      options.entry.predicates ??
      (options.preferInitialFilters ? options.initial.predicates : undefined) ??
      options.persisted.predicates ??
      options.initial.predicates,
  };
}
