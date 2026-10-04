import type { ListView } from '@app/constants/list-views';
import type { SetPredicatesInput } from '../filters/filter-store/predicates-store';
import type { Query } from '../filters/filter-store/query-store';
import { getViewPreset } from '../sidebar/soup-filter-presets';

type ViewFilters = {
  query?: Query;
  predicates?: SetPredicatesInput<string>;
};

/** Resolve each destination independently: the split provider survives navigation. */
export function resolveInitialViewFilters(options: {
  view: ListView | undefined;
  rememberedTab: unknown;
  entry: ViewFilters;
  persisted: ViewFilters;
  initial: ViewFilters;
  preferInitialFilters?: boolean;
}): ViewFilters {
  const migrateReminderTab =
    options.view === 'reminders' && options.rememberedTab !== 'all';
  const entry = migrateReminderTab ? {} : options.entry;
  const fallback = migrateReminderTab
    ? {
        query: getViewPreset('reminders')?.filters,
        predicates: { and: ['reminders'] },
      }
    : options.initial;
  return {
    query:
      entry.query ??
      (options.preferInitialFilters ? options.initial.query : undefined) ??
      options.persisted.query ??
      fallback.query,
    predicates:
      entry.predicates ??
      (options.preferInitialFilters ? options.initial.predicates : undefined) ??
      options.persisted.predicates ??
      fallback.predicates,
  };
}
