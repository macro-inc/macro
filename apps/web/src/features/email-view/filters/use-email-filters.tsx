import type { ListFilterGroup } from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { createMemo } from 'solid-js';
import { useEmailView } from '../email-view-context';
import type { EmailFilterGroupId } from '../types';
import {
  EMAIL_FILTER_GROUPS,
  type EmailFilterGroup as EmailFilterGroupDefinition,
  REMINDER_FILTER_GROUPS,
} from './email-facets';

type EmailFilterGroup = ListFilterGroup<EmailFilterGroupId, string>;

const toFilterGroups = (
  groups: EmailFilterGroupDefinition[]
): EmailFilterGroup[] =>
  groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({
      ...option,
      icon: option.iconType
        ? () => <EntityIcon targetType={option.iconType} size="xs" />
        : undefined,
    })),
  }));

const STATIC_FILTER_GROUPS = toFilterGroups(EMAIL_FILTER_GROUPS);
const STATIC_REMINDER_FILTER_GROUPS = toFilterGroups(REMINDER_FILTER_GROUPS);

/** Shared selection semantics for the desktop menu and mobile drawer. */
export function useEmailFilters() {
  const { state, setFacets } = useEmailView();
  const tagGroup = useTagFilterGroup();
  // Reminders are not mail: none of the thread filters (or tags) apply, so
  // the tab offers its status group alone. Tags come last elsewhere: the
  // static groups are short, the tag list grows with use.
  const groups = createMemo((): EmailFilterGroup[] =>
    state.tab === 'reminders'
      ? STATIC_REMINDER_FILTER_GROUPS
      : [
          ...STATIC_FILTER_GROUPS,
          ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
        ]
  );
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
