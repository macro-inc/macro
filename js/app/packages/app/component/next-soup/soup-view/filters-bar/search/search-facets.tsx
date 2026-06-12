import type { CallStatus } from '@app/component/next-soup/filters/filter-store/types';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { EntityIcon as EntityIconWithAvatar } from '@entity/extractors/entity-icon';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import { useInboxPicker } from '../inbox-picker';
import type { SearchableOption } from '../searchable-multi-select';
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

const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  ATTENDED: 'Attended',
  MISSED: 'Missed',
  UNATTENDED: 'Unattended',
};

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
      }
  );

/**
 * Picker for the "In" chip (channels + DMs). Used by channel-message and
 * call-record search.
 */
function useChannelPicker(): Accessor<SearchableOption[]> {
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');

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
  const people = useList('person');

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
}): SearchFacetVM {
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

  const type = singleFacet({
    id: 'type',
    label: 'Type',
    options: [
      { id: 'all', label: 'All' },
      ...SEARCH_INDEX_OPTIONS.map((o) => ({
        id: o.value,
        label: o.label,
        icon: o.icon,
      })),
    ],
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
    onChange: inboxPicker.onChange,
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

  return createMemo(() => {
    switch (controller.type()) {
      case 'email':
        return inboxPicker.hasMultiple()
          ? [type, importance, inbox]
          : [type, importance];
      case 'channels':
        return [type, channelIn, channelFrom];
      case 'calls':
        return [type, callIn, callFrom, callStatus];
      default:
        return [type];
    }
  });
}
