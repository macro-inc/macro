import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import type {
  CallStatus,
  PropertyFilter,
  TagFilterMode,
} from '@app/features/next-soup/filters/filter-store/types';
import { usePosthog } from '@app/lib/analytics/posthog';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { EntityIcon as EntityIconWithAvatar } from '@entity/extractors/entity-icon';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { type Accessor, createEffect, createMemo, type JSX } from 'solid-js';
import { useInboxPicker } from '../inbox-picker';
import type { SearchableOption } from '../searchable-multi-select';
import { useTagOptions } from '../tag-filter';
import type {
  SearchFiltersController,
  SearchIndexId,
  SearchTypeValue,
} from './search-filters-state';

export const SEARCH_INDEX_OPTIONS: {
  value: SearchIndexId;
  label: string;
  icon: () => JSX.Element;
}[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => (
      <EntityIcon targetType="channel" size="xs" theme="monochrome" />
    ),
  },
  {
    value: 'document-or-file',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" theme="monochrome" />,
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" theme="monochrome" />,
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" theme="monochrome" />,
  },
  {
    value: 'calls',
    label: 'Calls',
    icon: () => <EntityIcon targetType="call" size="xs" theme="monochrome" />,
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => (
      <EntityIcon targetType="project" size="xs" theme="monochrome" />
    ),
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" theme="monochrome" />,
  },
];

/**
 * Calendar is offered as a search type only where the calendar UI is enabled:
 * opening an event needs the calendar block, which the same flag gates, so a
 * disabled workspace would surface events it can't open.
 */
const CALENDAR_TYPE_OPTION: (typeof SEARCH_INDEX_OPTIONS)[number] = {
  value: 'calendar',
  label: 'Calendar',
  icon: () => <EntityIcon targetType="calendar" size="xs" theme="monochrome" />,
};

const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  ATTENDED: 'Attended',
  MISSED: 'Missed',
  UNATTENDED: 'Unattended',
};

const optionIcon = (optionId: string) => () => (
  <PropertyValueIcon optionId={optionId} class="size-3.5" />
);

const TASK_STATUS_OPTIONS: SearchableOption[] = [
  {
    id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
    label: 'Not Started',
    icon: optionIcon(PROPERTY_OPTION_IDS.STATUS.NOT_STARTED),
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
    label: 'In Progress',
    icon: optionIcon(PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS),
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
    label: 'In Review',
    icon: optionIcon(PROPERTY_OPTION_IDS.STATUS.IN_REVIEW),
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    label: 'Completed',
    icon: optionIcon(PROPERTY_OPTION_IDS.STATUS.COMPLETED),
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.CANCELED,
    label: 'Canceled',
    icon: optionIcon(PROPERTY_OPTION_IDS.STATUS.CANCELED),
  },
];

const TASK_PRIORITY_OPTIONS: SearchableOption[] = [
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
    label: 'Urgent',
    icon: optionIcon(PROPERTY_OPTION_IDS.PRIORITY.URGENT),
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    label: 'High',
    icon: optionIcon(PROPERTY_OPTION_IDS.PRIORITY.HIGH),
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
    label: 'Medium',
    icon: optionIcon(PROPERTY_OPTION_IDS.PRIORITY.MEDIUM),
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.LOW,
    label: 'Low',
    icon: optionIcon(PROPERTY_OPTION_IDS.PRIORITY.LOW),
  },
];

export type FacetOption = {
  id: string;
  label: string;
  icon?: () => JSX.Element;
};

type FacetBase = {
  id: string;
  label: string;
  /** Display values — at least one entry; neutral state is synthesized. */
  values: Accessor<FacetOption[]>;
  isDefault: Accessor<boolean>;
  reset: () => void;
};

/** Optional any-of/all-of segment on a multi facet, à la Linear's label
 * filter. Rendered as its own dropdown segment between the facet label and
 * the values, only while `visible` (mode is meaningless under 2 values). */
export type FacetModeVM = {
  value: Accessor<TagFilterMode>;
  onSelect: (mode: TagFilterMode) => void;
  visible: Accessor<boolean>;
};

export type SearchFacetVM = FacetBase &
  (
    | {
        kind: 'single';
        options: FacetOption[];
        selectedId: Accessor<string>;
        onSelect: (id: string) => void;
      }
    | {
        kind: 'multi';
        options: Accessor<SearchableOption[]>;
        activeIds: Accessor<string[]>;
        onChange: (ids: string[]) => void;
        placeholder: string;
        preserveOrder?: boolean;
        onOnly?: (id: string) => void;
        mode?: FacetModeVM;
      }
  );

/**
 * Picker for the "In" chip (channels + DMs). Used by channel-message and
 * call-record search.
 */
function useChannelPicker(): Accessor<SearchableOption[]> {
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm').items;

  return createMemo(() =>
    channels()
      .filter((ch) => ch.data.name)
      .map((ch) => ({
        id: ch.id,
        label: ch.data.name,
        icon: () => (
          <div class="size-4">
            <EntityIconWithAvatar
              entity={ch.data}
              suppressClick
              showTooltip={false}
            />
          </div>
        ),
      }))
  );
}

/**
 * Picker for the "From" chip (people). Used by channel-message sender
 * filter and call-record speaker filter.
 */
function usePersonPicker(): Accessor<SearchableOption[]> {
  const { useList } = useQuickAccess();
  const currentUserId = useUserId();
  const people = useList('person').items;

  return createMemo(() => {
    const uid = currentUserId();
    let me: SearchableOption | undefined;
    const others: SearchableOption[] = [];
    for (const s of people()) {
      const opt: SearchableOption = {
        id: s.id,
        label:
          s.id === uid ? `${s.data.name || 'Me'} (me)` : s.data.name || s.id,
        icon: () => (
          <UserIcon id={s.id} size="sm" suppressClick showTooltip={false} />
        ),
      };
      if (s.id === uid) me = opt;
      else others.push(opt);
    }
    return [...(me ? [me] : []), ...others];
  });
}

function singleFacet(args: {
  id: string;
  label: string;
  options: FacetOption[];
  defaultId: string;
  selectedId: Accessor<string>;
  onSelect: (id: string) => void;
}): SearchFacetVM {
  return {
    kind: 'single',
    id: args.id,
    label: args.label,
    options: args.options,
    selectedId: args.selectedId,
    onSelect: args.onSelect,
    isDefault: () => args.selectedId() === args.defaultId,
    reset: () => args.onSelect(args.defaultId),
    values: () => {
      const selected = args.selectedId();
      const option = args.options.find((o) => o.id === selected);
      return [option ?? args.options[0]];
    },
  };
}

function multiFacet(args: {
  id: string;
  label: string;
  neutralLabel: string;
  placeholder: string;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
}): Extract<SearchFacetVM, { kind: 'multi' }> {
  return {
    kind: 'multi',
    id: args.id,
    label: args.label,
    options: args.options,
    activeIds: args.activeIds,
    onChange: args.onChange,
    placeholder: args.placeholder,
    isDefault: () => args.activeIds().length === 0,
    reset: () => args.onChange([]),
    values: () => {
      const ids = args.activeIds();
      if (ids.length === 0) return [{ id: 'all', label: args.neutralLabel }];
      const options = args.options();
      return ids.map((id) => {
        const option = options.find((o) => o.id === id);
        return { id, label: option?.label ?? id, icon: option?.icon };
      });
    },
  };
}

/**
 * Materializes the facet registry against the controller. Each facet is
 * defined once; which ones render follows the active type. Adding a facet =
 * one definition here + its compile line in `compileSearchQuery`.
 */
export function useSearchFacets(
  controller: SearchFiltersController
): Accessor<SearchFacetVM[]> {
  const channelOptions = useChannelPicker();
  const personOptions = usePersonPicker();
  const inboxPicker = useInboxPicker({
    selectedIds: controller.emailInbox,
    setSelectedIds: controller.setEmailInbox,
  });

  const tagSource = useTagOptions();
  const calendarSearchEnabled = useCalendarSearchUiFlag();
  const posthog = usePosthog();

  // The calendar type exists only while calendar search is enabled. If the flag
  // turns off (or a persisted search restores a calendar scope while it is off),
  // its Type option disappears and the chip falls back to "All", but the
  // compiled query would still carry the calendar seed — reset the type so the
  // displayed chip and the query agree. Wait for the flags to load first: a
  // PostHog flag reads `false` until it resolves, and resetting on that would
  // rewrite a legitimately-restored Calendar search to All before the flag
  // arrives.
  createEffect(() => {
    if (
      posthog.flagsLoaded() &&
      !calendarSearchEnabled() &&
      controller.type() === 'calendar'
    ) {
      controller.setType('all');
    }
  });

  const typeOptions = createMemo<FacetOption[]>(() => [
    { id: 'all', label: 'All' },
    ...[
      ...SEARCH_INDEX_OPTIONS,
      ...(calendarSearchEnabled() ? [CALENDAR_TYPE_OPTION] : []),
    ].map((o) => ({ id: o.value, label: o.label, icon: o.icon })),
  ]);

  const buildTypeFacet = () =>
    singleFacet({
      id: 'type',
      label: 'Type',
      options: typeOptions(),
      defaultId: 'all',
      selectedId: controller.type,
      onSelect: (id) => controller.setType(id as SearchTypeValue),
    });

  const importance = singleFacet({
    id: 'importance',
    label: 'Importance',
    options: [
      { id: 'all', label: 'All' },
      { id: 'signal', label: 'Signal' },
      { id: 'noise', label: 'Noise' },
    ],
    defaultId: 'all',
    selectedId: () => {
      const value = controller.emailImportance();
      if (value === undefined) return 'all';
      return value ? 'signal' : 'noise';
    },
    onSelect: (id) =>
      controller.setEmailImportance(id === 'all' ? undefined : id === 'signal'),
  });

  const inbox: SearchFacetVM = {
    kind: 'multi',
    id: 'email-inbox',
    label: 'Inbox',
    options: inboxPicker.options,
    activeIds: inboxPicker.activeIds,
    onChange: (ids) =>
      ids.length ? inboxPicker.onChange(ids) : inboxPicker.reset(),
    onOnly: inboxPicker.selectOnly,
    placeholder: 'Search inboxes...',
    preserveOrder: true,
    isDefault: inboxPicker.isDefault,
    reset: inboxPicker.reset,
    values: () => {
      const ids = controller.emailInbox();
      if (ids === undefined) return [{ id: 'all', label: 'All inboxes' }];
      if (ids.length === 0) return [{ id: 'none', label: 'No inboxes' }];
      const options = inboxPicker.options();
      return ids.map((id) => {
        const option = options.find((o) => o.id === id);
        return { id, label: option?.label ?? id, icon: option?.icon };
      });
    },
  };

  const channelIn = multiFacet({
    id: 'channel-in',
    label: 'In',
    neutralLabel: 'All channels',
    placeholder: 'Search channels...',
    options: channelOptions,
    activeIds: controller.channelIn,
    onChange: controller.setChannelIn,
  });

  const channelFrom = multiFacet({
    id: 'channel-from',
    label: 'From',
    neutralLabel: 'Anyone',
    placeholder: 'Search senders...',
    options: personOptions,
    activeIds: controller.channelFrom,
    onChange: controller.setChannelFrom,
  });

  const callIn = multiFacet({
    id: 'call-in',
    label: 'In',
    neutralLabel: 'All channels',
    placeholder: 'Search channels...',
    options: channelOptions,
    activeIds: controller.callIn,
    onChange: controller.setCallIn,
  });

  const callFrom = multiFacet({
    id: 'call-from',
    label: 'From',
    neutralLabel: 'Anyone',
    placeholder: 'Search speakers...',
    options: personOptions,
    activeIds: controller.callFrom,
    onChange: controller.setCallFrom,
  });

  const callStatus = singleFacet({
    id: 'call-status',
    label: 'Status',
    options: [
      { id: 'all', label: 'All' },
      ...(Object.keys(CALL_STATUS_LABELS) as CallStatus[]).map((status) => ({
        id: status,
        label: CALL_STATUS_LABELS[status],
      })),
    ],
    defaultId: 'all',
    selectedId: () => controller.callStatus() ?? 'all',
    onSelect: (id) =>
      controller.setCallStatus(id === 'all' ? undefined : (id as CallStatus)),
  });

  const taskStatus = multiFacet({
    id: 'task-status',
    label: 'Status',
    neutralLabel: 'Any status',
    placeholder: 'Filter by status...',
    options: () => TASK_STATUS_OPTIONS,
    activeIds: controller.taskStatus,
    onChange: controller.setTaskStatus,
  });

  const taskPriority = multiFacet({
    id: 'task-priority',
    label: 'Priority',
    neutralLabel: 'Any priority',
    placeholder: 'Filter by priority...',
    options: () => TASK_PRIORITY_OPTIONS,
    activeIds: controller.taskPriority,
    onChange: controller.setTaskPriority,
  });

  const taskAssignee = multiFacet({
    id: 'task-assignee',
    label: 'Assignee',
    neutralLabel: 'Anyone',
    placeholder: 'Search assignees...',
    options: personOptions,
    activeIds: controller.taskAssignees,
    onChange: controller.setTaskAssignees,
  });

  const taskCreatedBy = multiFacet({
    id: 'task-created-by',
    label: 'Created by',
    neutralLabel: 'Anyone',
    placeholder: 'Search creators...',
    options: personOptions,
    activeIds: controller.taskCreatedBy,
    onChange: controller.setTaskCreatedBy,
  });

  const tags: SearchFacetVM = {
    ...multiFacet({
      id: 'tags',
      label: 'Tags',
      neutralLabel: 'Any tag',
      placeholder: 'Filter by tag...',
      options: tagSource.options,
      activeIds: () => controller.tags().map((t) => t.value),
      onChange: (ids) => {
        const byOption = tagSource.defByOption();
        controller.setTags(
          ids.reduce<PropertyFilter[]>((acc, id) => {
            const propertyId = byOption.get(id);
            if (propertyId) acc.push({ propertyId, type: 'select', value: id });
            return acc;
          }, [])
        );
      },
    }),
    mode: {
      value: controller.tagMode,
      onSelect: controller.setTagMode,
      visible: () => controller.tags().length >= 2,
    },
  };

  // Tags show only where tagging applies (all/documents/tasks/emails/agents/
  // folders), and hidden when the caller has no tags defined.
  const tagFacets = (): SearchFacetVM[] => (tagSource.hasTags() ? [tags] : []);

  return createMemo(() => {
    const type = buildTypeFacet();
    switch (controller.type()) {
      case 'email':
        return inboxPicker.hasMultiple()
          ? [type, importance, inbox, ...tagFacets()]
          : [type, importance, ...tagFacets()];
      case 'channels':
        return [type, channelIn, channelFrom];
      case 'calls':
        return [type, callIn, callFrom, callStatus, ...tagFacets()];
      case 'task':
        return [
          type,
          taskStatus,
          taskPriority,
          taskAssignee,
          taskCreatedBy,
          ...tagFacets(),
        ];
      case 'document-or-file':
      case 'agent':
      case 'folders':
      case 'all':
        return [type, ...tagFacets()];
      // Calendar keyword search only for now; who/where/when facets come later.
      case 'calendar':
        return [type];
      default:
        return [type];
    }
  });
}
