import type { PropertyFilter } from '@app/features/next-soup/filters/filter-store';
import type { QueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import { TagDot } from '@property/tags/TagDot';
import { useTagsQuery } from '@queries/properties/tags';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { batch, createEffect, createMemo } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/**
 * Creates the tag resources shared by every surface in one soup view. Keeping
 * this at the provider boundary prevents each filter surface and virtual row
 * from attaching another observer to the same TanStack query.
 */
export function createTagOptions() {
  const tagsQuery = useTagsQuery();

  const tagSets = (): TagSetResponse[] =>
    tagsQuery.isSuccess ? tagsQuery.data : [];

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

  // The query serves an empty placeholder until its first response, and a
  // cached list can predate a tag made elsewhere until its refetch lands, so
  // only a settled response says which tags exist.
  const settled = () =>
    tagsQuery.isSuccess &&
    !tagsQuery.isPlaceholderData &&
    !tagsQuery.isFetching;

  return {
    settled,
    hasTags: () => options().length > 0,
    tagSets,
    options,
    optionsById,
    defByOption,
  };
}

export function createTagFilter(queryFilters: QueryStore) {
  const metadata = createTagOptions();
  const { defByOption } = metadata;
  const activeIds = createMemo(() =>
    (queryFilters.state.include.tagFilters ?? []).map((tag) => tag.value)
  );

  // A deleted tag (here, in another tab, or by a teammate) leaves its option id
  // in the stored and persisted filters: the chip has no label to show and the
  // query keeps asking for a tag nothing carries. Drop it so the chip and the
  // query agree; the remaining tags stay selected.
  createEffect(() => {
    if (!metadata.settled()) return;

    const byOption = defByOption();
    const deleted = (queryFilters.state.include.tagFilters ?? []).filter(
      (filter) => !byOption.has(filter.value)
    );
    if (deleted.length === 0) return;

    queryFilters.remove({ include: { tagFilters: deleted } });
  });

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
    ...metadata,
    activeIds,
    onChange,
  };
}

export type TagFilter = ReturnType<typeof createTagFilter>;
