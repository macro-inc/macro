import type {
  ListControlOption,
  ListFilterGroup,
} from '@app/components/view-shell';
import { FilterTextSubmenu } from '@app/features/next-soup/soup-view/filters-bar/filter-menu';
import { t } from '@app/lib/i18n';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  describeParticipant,
  PARTICIPANT_FIELDS,
  parseParticipant,
  parseSubject,
  participantFieldLabel,
  participantOption,
  participantsOf,
  participantValue,
} from '../components/EmailFilterFields';
import { type EmailListFilters, useEmailView } from '../email-view-context';
import { useEmailParticipantSuggestions } from '../queries/use-email-participant-suggestions';
import {
  EMAIL_RECEIVED_WITHIN_DAYS,
  type EmailFilterGroupId,
  type EmailViewConditions,
} from '../types';
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
const facetGroup = (id: EmailFilterGroupId) =>
  STATIC_FILTER_GROUPS.filter((group) => group.id === id);

// Focus lists only threads still in the inbox, so Done has nothing to filter.
// Read status filters on the client, where opening a thread would mark it read and
// drop it from an Unread list mid-read, so Focus leaves it out too.
const FOCUS_FILTER_GROUPS: EmailFilterGroup[] = [
  withIcons(EMAIL_FOCUS_FILTER_GROUP),
  ...STATIC_FILTER_GROUPS.filter(
    (group) => group.id !== 'done' && group.id !== 'read'
  ),
];

const ANY = 'any';

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

/** A condition only a saveable tab or an open view has. */
const conditionField = (
  read: (conditions: EmailViewConditions) => readonly string[],
  write: (ids: string[]) => Partial<EmailViewConditions>
): EmailFilterField => ({
  read: (filters) => (filters.conditions ? read(filters.conditions) : []),
  write: (filters, ids) =>
    filters.conditions
      ? { conditions: { ...filters.conditions, ...write(ids) } }
      : {},
});

const IMPORTANCE = ['signal', 'noise'] as const;

const emailFilterField = (groupId: EmailFilterGroupId): EmailFilterField =>
  match(groupId)
    .with('people', () =>
      conditionField(
        (conditions) => conditions.participants.map(participantValue),
        (ids) => ({ participants: participantsOf(ids) })
      )
    )
    .with('matchFrom', () =>
      conditionField(
        (conditions) => conditions.participantFields,
        (ids) => {
          const fields = PARTICIPANT_FIELDS.filter((field) =>
            ids.includes(field)
          );
          // Looking nowhere matches nothing, so the last field stays on.
          return fields.length > 0 ? { participantFields: fields } : {};
        }
      )
    )
    .with('subject', () =>
      conditionField(
        (conditions) => conditions.subject,
        (ids) => ({ subject: ids })
      )
    )
    .with('importance', () =>
      conditionField(
        (conditions) => (conditions.importance ? [conditions.importance] : []),
        (ids) => ({
          importance: IMPORTANCE.find((value) => ids.includes(value)),
        })
      )
    )
    .with('received', () =>
      conditionField(
        (conditions) =>
          conditions.receivedWithinDays
            ? [String(conditions.receivedWithinDays)]
            : [],
        (ids) => ({
          receivedWithinDays: EMAIL_RECEIVED_WITHIN_DAYS.find((days) =>
            ids.includes(String(days))
          ),
        })
      )
    )
    .with('starred', () =>
      conditionField(
        (conditions) => (conditions.starred ? ['starred'] : []),
        (ids) => ({ starred: ids.includes('starred') })
      )
    )
    .with(
      'inboxes',
      (): EmailFilterField => ({
        read: (filters) => filters.inboxIds ?? [],
        write: (_, ids) => ({ inboxIds: ids.length > 0 ? ids : undefined }),
      })
    )
    .with('read', 'done', 'attachments', 'calendar', 'focus', 'tags', (id) =>
      facetField(id)
    )
    .exhaustive();

const sameValues = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value) => right.includes(value));

/**
 * Selection semantics for the desktop menu and mobile drawer. A group counts
 * as active once it differs from what Clear returns to, so a tab's own
 * restrictions show as selected without reading as extra filters.
 */
function createEmailFilterModel(options: {
  groups: Accessor<EmailFilterGroup[]>;
  filters: Accessor<EmailListFilters>;
  baseline: Accessor<EmailListFilters>;
  setFilters: (filters: Partial<EmailListFilters>) => void;
}) {
  const groupFor = (groupId: string) =>
    options.groups().find((group) => group.id === groupId);
  const fieldFor = (groupId: string) => {
    const group = groupFor(groupId);
    return group ? emailFilterField(group.id) : undefined;
  };
  const selectedIds = (groupId: string) => [
    ...(fieldFor(groupId)?.read(options.filters()) ?? []),
  ];
  const setGroupSelection = (groupId: string, ids: readonly string[]) => {
    const field = fieldFor(groupId);
    if (field) options.setFilters(field.write(options.filters(), [...ids]));
  };
  const isGroupActive = (groupId: string) => {
    const field = fieldFor(groupId);
    return (
      !!field &&
      !sameValues(field.read(options.filters()), field.read(options.baseline()))
    );
  };

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

const anyOption = (): ListControlOption<string> => ({
  id: ANY,
  label: t('emailViews.any'),
});

/** People and companies to pick from, chosen ones first even when unlisted. */
function useParticipantOptions(chosen: Accessor<readonly string[]>) {
  const suggestions = useEmailParticipantSuggestions();
  return createMemo((): ListControlOption<string>[] => {
    const suggested = suggestions().map(participantOption);
    const listed = new Set(suggested.map((option) => option.value));
    return [
      ...chosen()
        .filter((value) => !listed.has(value))
        .map((value) => ({ value, ...describeParticipant(value) })),
      ...suggested,
    ].map((option) => ({
      id: option.value,
      // Search reads the label, so it carries the address or domain too.
      label: option.detail ? `${option.label} ${option.detail}` : option.label,
      icon: option.icon,
      content: () => (
        // The name keeps its room; the address or count gives way first.
        <span class="flex min-w-0 items-baseline gap-1.5">
          <span class="max-w-full shrink-0 truncate">{option.label}</span>
          {option.detail && (
            <span class="min-w-0 truncate text-xs text-ink-muted">
              {option.detail}
            </span>
          )}
        </span>
      ),
    }));
  });
}

/**
 * The Email view's Filters: every condition a saved view can hold on tabs a
 * view can hold (and in an open view), the facets alone elsewhere, and the
 * inboxes everywhere there is a choice.
 */
export function useEmailFilters() {
  const { state, setFilters, filterBaseline, inboxOptions } = useEmailView();
  const tagGroup = useTagFilterGroup();
  const people = () =>
    state.conditions?.participants.map(participantValue) ?? [];
  const peopleOptions = useParticipantOptions(people);
  const tags = () => (tagGroup().options.length > 0 ? [tagGroup()] : []);
  const inboxes = (): EmailFilterGroup[] =>
    inboxOptions().length > 1 || state.aliasFilter
      ? [
          {
            id: 'inboxes',
            label: t('emailViews.inboxes'),
            options: inboxOptions().map((inbox) => ({
              id: inbox.id,
              label: inbox.label,
            })),
          },
        ]
      : [];
  const conditionGroups = (): EmailFilterGroup[] => [
    {
      id: 'people',
      label: t('emailViews.people'),
      searchPlaceholder: t('emailViews.peoplePlaceholder'),
      options: peopleOptions(),
      createOption: (query) => {
        const value = parseParticipant(query);
        return value
          ? {
              id: value,
              label: t('emailViews.addEntry', { entry: query }),
              icon: describeParticipant(value).icon,
            }
          : undefined;
      },
    },
    ...(people().length > 0
      ? [
          {
            id: 'matchFrom' as const,
            label: t('emailViews.matchFrom'),
            options: PARTICIPANT_FIELDS.map((field) => ({
              id: field,
              label: participantFieldLabel(field),
            })),
          },
        ]
      : []),
    {
      id: 'subject',
      label: t('emailViews.subjectContains'),
      options: [],
      submenu: () => (
        <FilterTextSubmenu
          label={t('emailViews.subjectContains')}
          value={state.conditions?.subject.join(', ') ?? ''}
          placeholder={t('emailViews.subjectPlaceholder')}
          onChange={(text) =>
            model.setGroupSelection('subject', parseSubject(text))
          }
        />
      ),
    },
    ...tags(),
    {
      id: 'importance',
      label: t('emailViews.importance'),
      selectionMode: 'single',
      defaultOptionId: ANY,
      options: [
        ...IMPORTANCE.map((value) => ({
          id: value,
          label: t(
            value === 'signal' ? 'emailViews.signal' : 'emailViews.noise'
          ),
        })),
        anyOption(),
      ],
    },
    ...facetGroup('read'),
    ...facetGroup('done'),
    {
      id: 'received',
      label: t('emailViews.received'),
      selectionMode: 'single',
      defaultOptionId: ANY,
      options: [
        ...EMAIL_RECEIVED_WITHIN_DAYS.map((days) => ({
          id: String(days),
          label: t('emailViews.lastDays', { count: days }),
        })),
        anyOption(),
      ],
    },
    ...inboxes(),
    {
      id: 'starred',
      label: t('emailViews.starred'),
      selectionMode: 'single',
      defaultOptionId: ANY,
      options: [{ id: 'starred', label: t('emailViews.starred') }, anyOption()],
    },
    ...facetGroup('attachments'),
    ...facetGroup('calendar'),
  ];

  const model = createEmailFilterModel({
    groups: createMemo((): EmailFilterGroup[] => {
      if (state.conditions) return conditionGroups();
      return [
        ...(state.tab === 'focus' ? FOCUS_FILTER_GROUPS : STATIC_FILTER_GROUPS),
        // Tags come last: the static groups are short, the tag list grows with use.
        ...tags(),
        ...inboxes(),
      ];
    }),
    filters: () => state,
    baseline: () => ({ ...filterBaseline(), inboxIds: undefined }),
    setFilters,
  });
  return model;
}

/** Shared Email filters without coupling an embedded list to the Email host. */
export function createEmailFilters(
  facets: Accessor<EmailListFilters['facets']>,
  setFacets: (facets: EmailListFilters['facets']) => void
) {
  const tagGroup = useTagFilterGroup();
  return createEmailFilterModel({
    groups: createMemo((): EmailFilterGroup[] => [
      ...STATIC_FILTER_GROUPS,
      ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
    ]),
    filters: () => ({ facets: facets(), inboxIds: undefined }),
    baseline: () => ({ facets: {}, inboxIds: undefined }),
    setFilters: (filters) => {
      if (filters.facets) setFacets(filters.facets);
    },
  });
}
