import type {
  Query,
  QueryState,
} from '@app/features/next-soup/filters/filter-store';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import { deepEqual } from '@core/util/compareUtils';

type SearchPreset = {
  filters: Query;
  clientFilters: { and?: readonly string[]; or?: readonly string[] };
};

/**
 * Whether the Search view has nothing to search for yet: no text and no
 * filter beyond its tab's defaults. It then lists nothing, so opening Search
 * starts from its empty state instead of an unfiltered feed.
 */
export function searchAwaitsInput(args: {
  text: string;
  state: QueryState;
  activeFilterIds: readonly string[];
  assigneeCount: number;
  preset: SearchPreset | undefined;
}): boolean {
  if (args.text.trim().length > 0 || args.assigneeCount > 0) return false;
  if (!args.preset) return true;

  const presetIds = new Set([
    ...(args.preset.clientFilters.and ?? []),
    ...(args.preset.clientFilters.or ?? []),
  ]);
  const activeIds = new Set(args.activeFilterIds);
  if (
    presetIds.size !== activeIds.size ||
    [...presetIds].some((id) => !activeIds.has(id))
  ) {
    return false;
  }

  const preset = queryStateFrom(args.preset.filters);
  return (
    deepEqual(args.state.include, preset.include) &&
    deepEqual(args.state.exclude, preset.exclude) &&
    deepEqual(args.state.documentWhere, preset.documentWhere) &&
    args.state.emailView === preset.emailView
  );
}
