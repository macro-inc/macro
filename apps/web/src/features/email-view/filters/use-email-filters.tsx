import type { ListFilterGroup } from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { createMemo } from 'solid-js';
import { useEmailView } from '../email-view-context';
import type { EmailFilterGroupId } from '../types';
import { EMAIL_FILTER_GROUPS, EMAIL_FOCUS_FILTER_GROUP } from './email-facets';

type EmailFilterGroup = ListFilterGroup<EmailFilterGroupId, string>;

const withIcons = (
  group: (typeof EMAIL_FILTER_GROUPS)[number]
): EmailFilterGroup => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: option.iconType
      ? () => <EntityIcon targetType={option.iconType} size="xs" />
      : undefined,
  })),
});

const STATIC_FILTER_GROUPS: EmailFilterGroup[] =
  EMAIL_FILTER_GROUPS.map(withIcons);

// Focus lists only threads still in the inbox, so Done has nothing to filter.
// Status filters on the client, where opening a thread would mark it read and
// drop it from an Unread list mid-read, so Focus leaves it out too.
const FOCUS_FILTER_GROUPS: EmailFilterGroup[] = [
  withIcons(EMAIL_FOCUS_FILTER_GROUP),
  ...STATIC_FILTER_GROUPS.filter(
    (group) => group.id !== 'done' && group.id !== 'read'
  ),
];

/** Shared selection semantics for the desktop menu and mobile drawer. */
export function useEmailFilters() {
  const { state, setFacets } = useEmailView();
  const tagGroup = useTagFilterGroup();
  // Tags come last: the static groups are short, the tag list grows with use.
  const groups = createMemo((): EmailFilterGroup[] => [
    ...(state.tab === 'focus' ? FOCUS_FILTER_GROUPS : STATIC_FILTER_GROUPS),
    ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
  ]);
  const groupFor = (groupId: EmailFilterGroupId) =>
    groups().find((group) => group.id === groupId);
  const activeFilterCount = createMemo(() =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    )
  );

  // Single-select groups carry an "All" option that stands for no selection.
  const isSelected = (groupId: EmailFilterGroupId, optionId: string) => {
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
    optionId: string,
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
    groups,
    activeCount: activeFilterCount,
    isSelected,
    setSelected,
    clear: () => setFacets({}),
  };
}
