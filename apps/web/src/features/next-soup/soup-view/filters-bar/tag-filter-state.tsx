import type { PropertyFilter } from '@app/features/next-soup/filters/filter-store';
import type { QueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_TAGS_FE_FLAG,
  ENABLE_TAGS_FE_OVERRIDE,
} from '@core/constant/featureFlags';
import { TagDot } from '@property/tags/TagDot';
import { useTagsQuery } from '@queries/properties/tags';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { batch, createMemo } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/**
 * Creates the tag resources shared by every surface in one soup view. Keeping
 * this at the provider boundary prevents each filter surface and virtual row
 * from attaching another observer to the same TanStack query.
 */
export function createTagFilter(queryFilters: QueryStore) {
  const tagsFlag = useFeatureFlag(ENABLE_TAGS_FE_FLAG, {
    enabledOverride: ENABLE_TAGS_FE_OVERRIDE,
  });
  const tagsQuery = useTagsQuery();

  const tagSets = (): TagSetResponse[] => tagsQuery.data ?? [];

  const defByOption = createMemo(() => {
    const map = new Map<string, string>();
    for (const set of tagSets()) {
      for (const option of set.options) {
        map.set(option.id, option.propertyDefinitionId);
      }
    }
    return map;
  });

  const options = createMemo<SearchableOption[]>(() =>
    tagSets().flatMap((set) =>
      set.options.map((option) => ({
        id: option.id,
        label: option.value.type === 'string' ? option.value.value : option.id,
        icon: () => <TagDot color={option.color ?? undefined} />,
      }))
    )
  );

  const optionsById = createMemo(() => {
    const map = new Map<string, SearchableOption>();
    for (const option of options()) map.set(option.id, option);
    return map;
  });

  const activeIds = createMemo(() =>
    (queryFilters.state.include.tagFilters ?? []).map((tag) => tag.value)
  );

  const onChange = (ids: string[]) => {
    const byOption = defByOption();
    const current = activeIds();
    const currentFilters = queryFilters.state.include.tagFilters ?? [];
    const addProps = ids.reduce<PropertyFilter[]>((acc, id) => {
      if (current.includes(id)) return acc;
      const propertyId = byOption.get(id);
      if (propertyId) acc.push({ propertyId, type: 'select', value: id });
      return acc;
    }, []);
    // Remove from the stored filters, not from freshly-derived ones: the stored
    // entry keeps its definition id even if the tag was deleted or the tag list
    // has not loaded, so deselecting always clears the filter.
    const removeProps = currentFilters.filter(
      (filter) => !ids.includes(filter.value)
    );
    batch(() => {
      if (removeProps.length) {
        queryFilters.remove({ include: { tagFilters: removeProps } });
      }
      if (addProps.length) {
        queryFilters.add({ include: { tagFilters: addProps } });
      }
    });
  };

  return {
    enabled: () => tagsFlag().enabled,
    hasTags: () => options().length > 0,
    tagSets,
    options,
    optionsById,
    defByOption,
    activeIds,
    onChange,
  };
}

export type TagFilter = ReturnType<typeof createTagFilter>;
