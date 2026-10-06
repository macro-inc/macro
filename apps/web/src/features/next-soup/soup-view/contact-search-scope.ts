import type { ListView } from '@app/constants/list-views';
import {
  type QueryState,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { FieldFilters } from '@app/features/next-soup/filters/filter-store/types';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { deepEqual } from '@core/util/compareUtils';

const setFields = (fields: FieldFilters) =>
  Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0)
    )
  );

/**
 * Global Search lists CRM contacts only in its unscoped All search. A type,
 * tag, folder, or Command-K category scope narrows results to entity types
 * contacts are not, so contacts are neither fetched nor shown there.
 */
export function isContactSearchScope(options: {
  view: ListView | undefined;
  filters: QueryState;
  predicates: { and: readonly string[]; or: readonly string[] };
}): boolean {
  if (options.view !== 'search') return false;
  if (options.predicates.or.length > 0) return false;
  if (options.predicates.and.some((id) => id !== 'search-supported'))
    return false;
  const preset = getViewPreset('search');
  if (!preset) return false;
  const baseline = queryStateFrom(preset.filters);
  return (
    deepEqual(
      setFields(options.filters.include),
      setFields(baseline.include)
    ) &&
    deepEqual(
      setFields(options.filters.exclude),
      setFields(baseline.exclude)
    ) &&
    !options.filters.documentWhere?.length &&
    options.filters.emailView === undefined
  );
}
