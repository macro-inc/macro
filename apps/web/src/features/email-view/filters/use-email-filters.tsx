import type { ListFilterGroup } from '@app/components/view-shell';
import type { FacetSelection } from '@app/features/soup';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { type Accessor, createMemo } from 'solid-js';
import { type EmailListFilters, useEmailView } from '../email-view-context';
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

/** One group's selection, read from and written into the list's filters. */
type EmailFilterField = {
  read: (filters: EmailListFilters) => readonly string[];
  write: (
    filters: EmailListFilters,
    ids: string[]
  ) => Partial<EmailListFilters>;
};

const facetField = (id: string): EmailFilterField => ({
  read: (filters) => filters.facets[id] ?? [],
  write: (filters, ids) => ({ facets: { ...filters.facets, [id]: ids } }),
});

const sameValues = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value) => right.includes(value));

/**
 * Selection semantics for the desktop menu and mobile drawer. A group counts
 * as active once it differs from what Clear returns to, so a tab's own
 * restrictions show as selected without reading as extra filters.
 */
function createEmailFilterModel(options: {
  groups: Accessor<EmailFilterGroup[]>;
  field: (groupId: string) => EmailFilterField;
  filters: Accessor<EmailListFilters>;
  baseline: Accessor<EmailListFilters>;
  setFilters: (filters: Partial<EmailListFilters>) => void;
}) {
  const groupFor = (groupId: string) =>
    options.groups().find((group) => group.id === groupId);
  const selectedIds = (groupId: string) => [
    ...options.field(groupId).read(options.filters()),
  ];
  const setGroupSelection = (groupId: string, ids: readonly string[]) =>
    options.setFilters(
      options.field(groupId).write(options.filters(), [...ids])
    );
  const isGroupActive = (groupId: string) =>
    !sameValues(
      options.field(groupId).read(options.filters()),
      options.field(groupId).read(options.baseline())
    );

  // Single-select groups carry an "All" option that stands for no selection.
  const isSelected = (groupId: string, optionId: string) => {
    const selected = selectedIds(groupId);
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
      setGroupSelection(
        groupId,
        optionId === group.defaultOptionId ? [] : [optionId]
      );
      return;
    }

    // Preserve unknown IDs during toggles; Only explicitly removes other IDs.
    const update = selected
      ? addUnique<string>(optionId)
      : removeValue<string>(optionId);
    setGroupSelection(groupId, update(selectedIds(groupId)));
  };

  return {
    groups: options.groups,
    activeCount: () =>
      options.groups().filter((group) => isGroupActive(group.id)).length,
    isGroupActive,
    isSelected,
    selectedIds,
    setSelected,
    setGroupSelection,
    clear: () => options.setFilters(options.baseline()),
  };
}

/** The Email view's Filters, over the tab's or open view's full filters. */
export function useEmailFilters() {
  const { state, setFilters, filterBaseline } = useEmailView();
  const tagGroup = useTagFilterGroup();
  return createEmailFilterModel({
    groups: createMemo((): EmailFilterGroup[] => [
      ...(state.tab === 'focus' ? FOCUS_FILTER_GROUPS : STATIC_FILTER_GROUPS),
      // Tags come last: the static groups are short, the tag list grows with use.
      ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
    ]),
    field: facetField,
    filters: () => state,
    baseline: () => ({ ...filterBaseline(), inboxIds: undefined }),
    setFilters,
  });
}

/** Shared Email filters without coupling an embedded list to the Email host. */
export function createEmailFilters(
  facets: Accessor<FacetSelection>,
  setFacets: (facets: FacetSelection) => void
) {
  const tagGroup = useTagFilterGroup();
  return createEmailFilterModel({
    groups: createMemo((): EmailFilterGroup[] => [
      ...STATIC_FILTER_GROUPS,
      ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
    ]),
    field: facetField,
    filters: () => ({ facets: facets(), inboxIds: undefined }),
    baseline: () => ({ facets: {}, inboxIds: undefined }),
    setFilters: (filters) => {
      if (filters.facets) setFacets(filters.facets);
    },
  });
}
