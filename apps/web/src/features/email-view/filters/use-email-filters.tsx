import type { ListFilterGroup } from '@app/components/view-shell';
import type { FacetSelection } from '@app/features/soup';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { type Accessor, createMemo } from 'solid-js';
import { useEmailView } from '../email-view-context';
import type { EmailFilterGroupId } from '../types';
import { EMAIL_FILTER_GROUPS } from './email-facets';

type EmailFilterGroup = ListFilterGroup<EmailFilterGroupId, string>;

const STATIC_FILTER_GROUPS: EmailFilterGroup[] = EMAIL_FILTER_GROUPS.map(
  (group) => ({
    ...group,
    options: group.options.map((option) => ({
      ...option,
      icon: option.iconType
        ? () => <EntityIcon targetType={option.iconType} size="xs" />
        : undefined,
    })),
  })
);

/** Shared selection semantics for the desktop menu and mobile drawer. */
export function useEmailFilters() {
  const { state, setFacets } = useEmailView();
  return createEmailFilters(() => state.facets, setFacets);
}

/** Shared Email filters without coupling an embedded list to the Email host. */
export function createEmailFilters(
  facets: Accessor<FacetSelection>,
  setFacets: (facets: FacetSelection) => void
) {
  const tagGroup = useTagFilterGroup();
  // Tags come last: the static groups are short, the tag list grows with use.
  const groups = createMemo((): EmailFilterGroup[] => [
    ...STATIC_FILTER_GROUPS,
    ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
  ]);
  const groupFor = (groupId: string) =>
    groups().find((group) => group.id === groupId);
  const activeFilterCount = createMemo(() =>
    Object.values(facets()).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    )
  );

  // Single-select groups carry an "All" option that stands for no selection.
  const isSelected = (groupId: string, optionId: string) => {
    const selected = facets()[groupId] ?? [];
    const group = groupFor(groupId);
    if (
      group?.selectionMode === 'single' &&
      optionId === group.defaultOptionId
    ) {
      return selected.length === 0;
    }

    return selected.includes(optionId);
  };

  const setSelected = (
    groupId: string,
    optionId: string,
    selected: boolean
  ) => {
    const group = groupFor(groupId);
    if (group?.selectionMode === 'single') {
      if (!selected) return;

      setFacets({
        ...facets(),
        [groupId]: optionId === group.defaultOptionId ? [] : [optionId],
      });
      return;
    }

    // Preserve unknown IDs during toggles; Only explicitly removes other IDs.
    const update = selected
      ? addUnique<string>(optionId)
      : removeValue<string>(optionId);
    setFacets({
      ...facets(),
      [groupId]: update(facets()[groupId]),
    });
  };

  return {
    groups,
    activeCount: activeFilterCount,
    isSelected,
    selectedIds: (groupId: string) => facets()[groupId] ?? [],
    setSelected,
    clear: () => setFacets({}),
  };
}
