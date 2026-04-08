import CheckIcon from '@icon/regular/check.svg';
import { cn } from '@ui/utils/classname';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { batch, createMemo, For, Show, type JSX } from 'solid-js';
import { FilterCombobox, type Option } from './filter-primitives';
import type { FilterID } from '@app/component/next-soup/filters/configs';

type IndexOption = {
  id: string;
  label: string;
  icon: () => JSX.Element;
  queryFilters: Record<string, unknown>;
};

const INDEX_OPTIONS: IndexOption[] = [
  {
    id: 'channels',
    label: 'Channels',
    icon: () => <EntityIcon targetType="channel" size="xs" />,
    queryFilters: QUERY_FILTERS.channels,
  },
  {
    id: 'document',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" />,
    queryFilters: QUERY_FILTERS.document,
  },
  {
    id: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" />,
    queryFilters: QUERY_FILTERS.email,
  },
  {
    id: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" />,
    queryFilters: QUERY_FILTERS.task,
  },
  {
    id: 'people',
    label: 'People',
    icon: () => <EntityIcon targetType="direct_message" size="xs" />,
    queryFilters: QUERY_FILTERS.people,
  },
  {
    id: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" />,
    queryFilters: QUERY_FILTERS.agent,
  },
  {
    id: 'file',
    label: 'Files',
    icon: () => <EntityIcon targetType="unknown" size="xs" />,
    queryFilters: QUERY_FILTERS.file,
  },
];

export const SearchIndexFilter = () => {
  const { soup, setQueryFilters } = useSoupView();

  const activeIndex = createMemo(() =>
    INDEX_OPTIONS.find((opt) => soup.filters.isActive(opt.id))
  );

  const handleClick = (option: IndexOption) => {
    const currentlyActive = soup.filters.isActive(option.id);

    batch(() => {
      // Clear any previously active index filter
      for (const opt of INDEX_OPTIONS) {
        if (soup.filters.isActive(opt.id)) {
          soup.filters.toggle({ or: [opt.id as FilterID] });
        }
      }

      if (currentlyActive) {
        setQueryFilters(QUERY_FILTERS.default);
      } else {
        soup.filters.toggle({ or: [option.id as FilterID] });
        setQueryFilters(option.queryFilters);
      }
    });
  };

  const isChannelsActive = () => activeIndex()?.id === 'channels';

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-1 flex-wrap">
        <span class="text-[10px] text-ink-faint uppercase tracking-wider mr-1">
          Index
        </span>
        <For each={INDEX_OPTIONS}>
          {(option) => {
            const active = () => soup.filters.isActive(option.id);
            return (
              <button
                type="button"
                class={cn(
                  'flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-xs border',
                  active()
                    ? 'bg-accent/6 text-accent border-accent/30 hover:bg-accent/25'
                    : 'bg-ink/3 text-ink-muted border-edge-muted/50 hover:bg-ink/12 hover:text-ink'
                )}
                onClick={() => handleClick(option)}
              >
                <span class="size-3.5 flex items-center justify-center shrink-0">
                  <Show when={active()} fallback={option.icon()}>
                    <CheckIcon class="size-3.5" />
                  </Show>
                </span>
                <span class="font-medium">{option.label}</span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={isChannelsActive()}>
        <div class="flex items-center gap-1.5">
          <InChannelFilter />
          <FromSenderFilter />
        </div>
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
          <EntityIcon
            targetType={
              ch.data.channelType === 'direct_message'
                ? 'direct_message'
                : 'channel'
            }
            size="xs"
          />
        ),
      }))
  );

  const activeChannelFilter = createMemo((): Option[] => {
    const ids = queryFilters().channel_filters?.channel_ids;
    if (!ids?.length) return [];
    return channelOptions().filter((opt) => ids.includes(opt.value));
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
    <FilterCombobox
      label="In"
      options={channelOptions()}
      active={activeChannelFilter()}
      onChange={handleChange}
      placeholder="Search channels..."
      virtualized
    />
  );
};

const FromSenderFilter = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const { useList } = useQuickAccess();
  const contacts = useList('person');

  const senderOptions = createMemo((): Option[] =>
    contacts().map((c) => ({
      value: c.id,
      label: c.data.name || c.id,
      icon: () => (
        <UserIcon id={c.id} size="xs" suppressClick showTooltip={false} />
      ),
    }))
  );

  const activeSenderFilter = createMemo((): Option[] => {
    const ids = queryFilters().channel_filters?.sender_ids;
    if (!ids?.length) return [];
    return senderOptions().filter((opt) => ids.includes(opt.value));
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
    <FilterCombobox
      label="From"
      options={senderOptions()}
      active={activeSenderFilter()}
      onChange={handleChange}
      placeholder="Search senders..."
      virtualized
    />
  );
};
