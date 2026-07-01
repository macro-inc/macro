import type { PropertyFilter } from '@app/component/next-soup/filters/filter-store';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_TAGS_FE_FLAG,
  ENABLE_TAGS_FE_OVERRIDE,
} from '@core/constant/featureFlags';
import { TagDot } from '@property/tags/TagDot';
import { useTagsQuery } from '@queries/properties/tags';
import { batch, createMemo } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/**
 * Shared tag-filter state for the list-view surfaces (the filter dropdown and
 * the active-filters chip bar). Tags are written to `queryFilters.tagFilters`
 * as PropertyFilters carrying their owning definition id (soup needs it for the
 * literal); the search request maps them to option ids alone. Multiple tags OR
 * together across definitions.
 */
export function useTagFilter() {
  const { queryFilters } = useSoupView();
  const tagsFlag = useFeatureFlag(ENABLE_TAGS_FE_FLAG, {
    enabledOverride: ENABLE_TAGS_FE_OVERRIDE,
  });
  const tagsQuery = useTagsQuery();

  const defByOption = createMemo(() => {
    const map = new Map<string, string>();
    for (const set of tagsQuery.data ?? []) {
      for (const option of set.options) {
        map.set(option.id, option.propertyDefinitionId);
      }
    }
    return map;
  });

  const options = createMemo<SearchableOption[]>(() =>
    (tagsQuery.data ?? []).flatMap((set) =>
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
    (queryFilters.state.include.tagFilters ?? []).map((t) => t.value)
  );

  const enabled = () => tagsFlag().enabled;
  const hasTags = () => options().length > 0;

  const toFilters = (ids: string[]): PropertyFilter[] => {
    const byOption = defByOption();
    return ids.reduce<PropertyFilter[]>((acc, id) => {
      const propertyId = byOption.get(id);
      if (propertyId) acc.push({ propertyId, type: 'select', value: id });
      return acc;
    }, []);
  };

  const onChange = (ids: string[]) => {
    const current = activeIds();
    const addProps = toFilters(ids.filter((id) => !current.includes(id)));
    const removeProps = toFilters(current.filter((id) => !ids.includes(id)));
    batch(() => {
      if (removeProps.length)
        queryFilters.remove({ include: { tagFilters: removeProps } });
      if (addProps.length)
        queryFilters.add({ include: { tagFilters: addProps } });
    });
  };

  return { enabled, hasTags, options, optionsById, activeIds, onChange };
}
