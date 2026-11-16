import type {
  ListControlOption,
  ListFilterGroup,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { EntityIcon } from '@core/component/EntityIcon';
import StarIcon from '@icon/system/regular/star.svg';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  describeParticipant,
  EmailMatchFromField,
  parseParticipant,
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
import {
  EMAIL_CALENDAR_OPTION_IDS,
  EMAIL_FILTER_GROUPS,
  EMAIL_FOCUS_FILTER_GROUP,
} from './email-facets';

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

/** Several fields as one group, each reading and writing the option ids it owns. */
const combinedField = (
  parts: { optionIds: readonly string[]; field: EmailFilterField }[]
): EmailFilterField => ({
  read: (filters) => parts.flatMap(({ field }) => field.read(filters)),
  write: (filters, ids) =>
    parts.reduce<Partial<EmailListFilters>>(
      (change, { optionIds, field }) => ({
        ...change,
        ...field.write(
          { ...filters, ...change },
          ids.filter((id) => optionIds.includes(id))
        ),
      }),
      {}
    ),
});

const STARRED = 'starred';

const IMPORTANCE = ['signal', 'noise'] as const;

const emailFilterField = (groupId: EmailFilterGroupId): EmailFilterField =>
  match(groupId)
    .with('people', () =>
      conditionField(
        (conditions) => conditions.participants.map(participantValue),
        (ids) => ({ participants: participantsOf(ids) })
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
    .with('has', () =>
      combinedField([
        {
          optionIds: [STARRED],
          field: conditionField(
            (conditions) => (conditions.starred ? [STARRED] : []),
            (ids) => ({ starred: ids.includes(STARRED) })
          ),
        },
        {
          optionIds: EMAIL_CALENDAR_OPTION_IDS,
          field: facetField('calendar'),
        },
      ])
    )
    .with(
      'inboxes',
      (): EmailFilterField => ({
        read: (filters) => filters.inboxIds ?? [],
        write: (_, ids) => ({ inboxIds: ids.length > 0 ? ids : undefined }),
      })
    )
    .with('read', 'done', 'attachments', 'focus', 'tags', (id) =>
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
  // Built once, so rebuilding the groups on a toggle keeps the same row.
  const matchFrom = (
    <div class="border-t border-edge-muted px-3 py-2">
      <EmailMatchFromField
        size="xs"
        fields={state.conditions?.participantFields ?? []}
        onChange={(participantFields) => {
          const conditions = state.conditions;
          if (conditions)
            setFilters({ conditions: { ...conditions, participantFields } });
        }}
      />
    </div>
  );
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
      // Where to look only means something once someone is chosen.
      footer: people().length > 0 ? matchFrom : undefined,
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
    // Starred is a view condition, so only here does "Has" offer it.
    ...facetGroup('has').map((group) => ({
      ...group,
      options: [
        {
          id: STARRED,
          label: t('emailViews.starred'),
          icon: () => <StarIcon class="size-4 shrink-0" />,
        },
        ...group.options,
      ],
    })),
    ...facetGroup('attachments'),
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
