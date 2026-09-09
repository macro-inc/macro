import type { ListFilterGroup } from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { createMemo } from 'solid-js';
import { useEmailView } from '../email-view-context';
import type { EmailFilterGroupId, EmailFilterOptionId } from '../types';
import { EMAIL_FILTER_GROUPS } from './email-facets';

const FILTER_GROUPS: ListFilterGroup<
  EmailFilterGroupId,
  EmailFilterOptionId
>[] = EMAIL_FILTER_GROUPS.map((group) => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: option.iconType
      ? () => <EntityIcon targetType={option.iconType} size="xs" />
      : undefined,
  })),
}));

const groupFor = (groupId: EmailFilterGroupId) =>
  FILTER_GROUPS.find((group) => group.id === groupId);

/** Shared selection semantics for the desktop menu and mobile drawer. */
export function useEmailFilters() {
  const { state, setFacets } = useEmailView();
  const activeFilterCount = createMemo(() =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    )
  );

  // Single-select groups carry an "All" option that stands for no selection.
  const isSelected = (
    groupId: EmailFilterGroupId,
    optionId: EmailFilterOptionId
  ) => {
    const selected = state.facets[groupId] ?? [];
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
    groupId: EmailFilterGroupId,
    optionId: EmailFilterOptionId,
    selected: boolean
  ) => {
    const group = groupFor(groupId);
    if (group?.selectionMode === 'single') {
      if (!selected) return;

      setFacets({
        ...state.facets,
        [groupId]: optionId === group.defaultOptionId ? [] : [optionId],
      });
      return;
    }

    // Persisted facets preserve unknown IDs; menu actions only accept known IDs.
    const update = selected
      ? addUnique<string>(optionId)
      : removeValue<string>(optionId);
    setFacets({
      ...state.facets,
      [groupId]: update(state.facets[groupId]),
    });
  };

  return {
    groups: FILTER_GROUPS,
    activeCount: activeFilterCount,
    isSelected,
    setSelected,
    clear: () => setFacets({}),
  };
}
