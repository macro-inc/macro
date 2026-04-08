import XIcon from '@icon/regular/x.svg';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import type { SoupBody } from '@queries/soup/items';
import { batch, createMemo, Show } from 'solid-js';
import { FilterCombobox, FilterSelect, type Option } from './filter-primitives';
import type { FilterID } from '@app/component/next-soup/filters/configs';

export const INDEX_OPTIONS: (Option & { queryFilters: SoupBody })[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => <EntityIcon targetType="channel" size="xs" />,
    queryFilters: QUERY_FILTERS.channels,
  },
  {
    value: 'document',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" />,
    queryFilters: QUERY_FILTERS.documentAndFile,
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" />,
    queryFilters: QUERY_FILTERS.task,
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" />,
    queryFilters: QUERY_FILTERS.email,
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => <EntityIcon targetType="project" size="xs" />,
    queryFilters: QUERY_FILTERS.folders,
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" />,
    queryFilters: QUERY_FILTERS.agent,
  },
];

const INDEX_SELECT_OPTIONS: Option[] = INDEX_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  icon: o.icon,
}));

export const SearchIndexFilter = () => {
  const { soup, queryFilters, setQueryFilters } = useSoupView();

  const activeIndex = createMemo((): Option[] => {
    const found = INDEX_OPTIONS.find((opt) => soup.filters.isActive(opt.value));
    return found
      ? [{ value: found.value, label: found.label, icon: found.icon }]
      : [];
  });

  const handleChange = (selected: Option[]) => {
    batch(() => {
      for (const opt of INDEX_OPTIONS) {
        if (soup.filters.isActive(opt.value)) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
        }
      }

      const prevChannelFilters = queryFilters().channel_filters;
      const channelSubFilters = {
        channel_ids: prevChannelFilters?.channel_ids,
        sender_ids: prevChannelFilters?.sender_ids,
      };

      if (selected.length > 0) {
        const opt = INDEX_OPTIONS.find((o) => o.value === selected[0].value);
        if (opt) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
          setQueryFilters({
            ...opt.queryFilters,
            channel_filters: {
              ...opt.queryFilters.channel_filters,
              ...channelSubFilters,
            },
          });
        }
      } else {
        setQueryFilters({
          ...QUERY_FILTERS.default,
          channel_filters: {
            ...channelSubFilters,
          },
        });
      }
    });
  };

  const indexLabel = createMemo(() => {
    const active = activeIndex();
    return active.length > 0 ? active[0].label : 'All';
  });

  const isChannelsActive = () =>
    activeIndex().some((o) => o.value === 'channels');

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label={indexLabel()}
        options={INDEX_SELECT_OPTIONS}
        active={activeIndex()}
        onChange={handleChange}
        multiple={false}
      />
      <Show when={isChannelsActive()}>
        <InChannelFilter />
        <FromSenderFilter />
      </Show>
    </div>
  );
};

const InChannelFilter = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');

  const channelOptions = createMemo((): Option[] =>
    channels()
      .filter((ch) => ch.data.name)
      .map((ch) => ({
        value: ch.id,
        label: ch.data.name,
        icon: () => (
          <EntityIcon targetType={ch.data.channelType || 'channel'} size="xs" />
        ),
      }))
  );

  const activeChannelFilter = createMemo((): Option[] => {
    const ids = queryFilters().channel_filters?.channel_ids;
    if (!ids?.length) return [];
    return channelOptions().filter((opt) => ids.includes(opt.value));
  });

  const inLabel = createMemo(() => {
    const active = activeChannelFilter();
    if (active.length === 0) return 'In';
    if (active.length === 1) return `In: ${active[0].label}`;
    return `In: ${active.length} channels`;
  });

  const handleChange = (selected: Option[]) => {
    const ids = selected.map((opt) => opt.value);
    setQueryFilters((prev) => ({
      ...prev,
      channel_filters: {
        ...prev.channel_filters,
        channel_ids: ids.length > 0 ? ids : undefined,
      },
    }));
  };

  return (
    <div class="flex items-stretch">
      <FilterCombobox
        label={inLabel()}
        options={channelOptions()}
        active={activeChannelFilter()}
        onChange={handleChange}
        placeholder="Search channels..."
        virtualized
      />
      <Show when={activeChannelFilter().length > 0}>
        <button
          type="button"
          class="flex items-center ml-[-1px] px-1 border border-accent/30 bg-accent/15 text-accent rounded-r-xs hover:bg-accent/25"
          onClick={() => handleChange([])}
        >
          <XIcon class="size-3" />
        </button>
      </Show>
    </div>
  );
};

const FromSenderFilter = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const { useList } = useQuickAccess();
  const contacts = useList('person');
  const userId = useUserId();

  const senderOptions = createMemo((): Option[] => {
    const currentUserId = userId();
    let me: Option | undefined;
    const others: Option[] = [];
    for (const c of contacts()) {
      const opt: Option = {
        value: c.id,
        label:
          c.id === currentUserId
            ? `${c.data.name || 'Me'} (me)`
            : c.data.name || c.id,
        icon: () => (
          <UserIcon id={c.id} size="xs" suppressClick showTooltip={false} />
        ),
      };
      if (c.id === currentUserId) {
        me = opt;
      } else {
        others.push(opt);
      }
    }
    return [...(me ? [me] : []), ...others];
  });

  const activeSenderFilter = createMemo((): Option[] => {
    const ids = queryFilters().channel_filters?.sender_ids;
    if (!ids?.length) return [];
    return senderOptions().filter((opt) => ids.includes(opt.value));
  });

  const fromLabel = createMemo(() => {
    const active = activeSenderFilter();
    if (active.length === 0) return 'From';
    if (active.length === 1) return `From: ${active[0].label}`;
    return `From: ${active.length} people`;
  });

  const handleChange = (selected: Option[]) => {
    const ids = selected.map((opt) => opt.value);
    setQueryFilters((prev) => ({
      ...prev,
      channel_filters: {
        ...prev.channel_filters,
        sender_ids: ids.length > 0 ? ids : undefined,
      },
    }));
  };

  return (
    <div class="flex items-stretch">
      <FilterCombobox
        label={fromLabel()}
        options={senderOptions()}
        active={activeSenderFilter()}
        onChange={handleChange}
        placeholder="Search senders..."
        virtualized
      />
      <Show when={activeSenderFilter().length > 0}>
        <button
          type="button"
          class="flex items-center ml-[-1px] px-1 border border-accent/30 bg-accent/15 text-accent rounded-r-xs hover:bg-accent/25"
          onClick={() => handleChange([])}
        >
          <XIcon class="size-3" />
        </button>
      </Show>
    </div>
  );
};
