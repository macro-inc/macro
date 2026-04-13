import XIcon from '@icon/regular/x.svg';
import { EntityIcon } from '@core/component/EntityIcon';
import { EntityIcon as EntityIconWithAvatar } from '@entity/extractors/entity-icon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  soupViewCacheKey,
  activeSoupViewCounts,
} from '@app/component/next-soup/soup-view/soup-view-cache-key';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { SoupBody } from '@queries/soup/items';
import { batch, createEffect, createMemo, Show } from 'solid-js';
import { FilterCombobox, FilterSelect, type Option } from './filter-primitives';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import type {
  ChannelFilters,
  EmailFilters,
} from '@service-storage/generated/schemas';

type ChannelSubFilters = Pick<ChannelFilters, 'channel_ids' | 'sender_ids'>;
type EmailSubFilters = Pick<EmailFilters, 'importance'>;

function getCachedChannelSubFilters(contentId: string): ChannelSubFilters {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return {};
  try {
    const raw = localStorage.getItem(
      soupViewCacheKey(contentId, 'channel-sub-filters')
    );
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function cacheChannelSubFilters(contentId: string, filters: ChannelSubFilters) {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return;
  try {
    localStorage.setItem(
      soupViewCacheKey(contentId, 'channel-sub-filters'),
      JSON.stringify(filters)
    );
  } catch {
    // best-effort: quota or security errors should not break filter flow
  }
}

function getCachedEmailSubFilters(contentId: string): EmailSubFilters {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return {};
  try {
    const raw = localStorage.getItem(
      soupViewCacheKey(contentId, 'email-sub-filters')
    );
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function cacheEmailSubFilters(contentId: string, filters: EmailSubFilters) {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return;
  try {
    localStorage.setItem(
      soupViewCacheKey(contentId, 'email-sub-filters'),
      JSON.stringify(filters)
    );
  } catch {
    // best-effort
  }
}

export const INDEX_OPTIONS: (Option & { queryFilters: SoupBody })[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => (
      <EntityIcon targetType="channel" size="xs" theme="monochrome" />
    ),
    queryFilters: QUERY_FILTERS.channels,
  },
  {
    value: 'document-or-file',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" theme="monochrome" />,
    queryFilters: QUERY_FILTERS.documentAndFile,
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" theme="monochrome" />,
    queryFilters: QUERY_FILTERS.task,
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" theme="monochrome" />,
    queryFilters: QUERY_FILTERS.email,
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => (
      <EntityIcon targetType="project" size="xs" theme="monochrome" />
    ),
    queryFilters: QUERY_FILTERS.folders,
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" theme="monochrome" />,
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
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;

  const activeIndex = createMemo((): Option[] => {
    const found = INDEX_OPTIONS.find((opt) => soup.filters.isActive(opt.value));
    return found
      ? [{ value: found.value, label: found.label, icon: found.icon }]
      : [];
  });

  const isChannelsActive = () =>
    activeIndex().some((o) => o.value === 'channels');
  const isEmailActive = () => activeIndex().some((o) => o.value === 'email');

  createEffect(() => {
    if (!isChannelsActive()) return;
    const cf = queryFilters().channel_filters;
    const sub: ChannelSubFilters = {};
    if (cf?.channel_ids?.length) sub.channel_ids = cf.channel_ids;
    if (cf?.sender_ids?.length) sub.sender_ids = cf.sender_ids;
    cacheChannelSubFilters(contentId, sub);
  });

  createEffect(() => {
    if (!isEmailActive()) return;
    const ef = queryFilters().email_filters;
    // Use null as sentinel for "explicitly cleared" since undefined is dropped by JSON.stringify
    cacheEmailSubFilters(contentId, { importance: ef?.importance ?? null });
  });

  const handleChange = (selected: Option[]) => {
    batch(() => {
      for (const opt of INDEX_OPTIONS) {
        if (soup.filters.isActive(opt.value)) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
        }
      }

      if (selected.length > 0) {
        const opt = INDEX_OPTIONS.find((o) => o.value === selected[0].value);
        if (opt) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
          if (opt.value === 'channels') {
            const cached = getCachedChannelSubFilters(contentId);
            setQueryFilters({
              ...opt.queryFilters,
              channel_filters: {
                ...opt.queryFilters.channel_filters,
                ...cached,
              },
            });
          } else if (opt.value === 'email') {
            const cached = getCachedEmailSubFilters(contentId);
            // null in cache means "explicitly cleared" — convert to undefined to override the default
            const importance =
              'importance' in cached
                ? (cached.importance ?? undefined)
                : opt.queryFilters.email_filters?.importance;
            setQueryFilters({
              ...opt.queryFilters,
              email_filters: {
                ...opt.queryFilters.email_filters,
                importance,
              },
            });
          } else {
            setQueryFilters({
              ...opt.queryFilters,
            });
          }
        }
      } else {
        setQueryFilters({
          ...QUERY_FILTERS.default,
          email_filters: { importance: true },
        });
      }
    });
  };

  const indexLabel = createMemo(() => {
    const active = activeIndex();
    const value = active.length > 0 ? active[0].label : 'All';
    return `Type: ${value}`;
  });

  const hasActiveIndex = () => activeIndex().length > 0;

  const clearFilters = () => {
    cacheChannelSubFilters(contentId, {});
    handleChange([]);
  };

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
      <Show when={isEmailActive()}>
        <EmailImportanceFilter />
      </Show>
      <Show when={hasActiveIndex()}>
        <button
          type="button"
          class="flex items-center px-1 py-1 text-ink-muted rounded-xs hover:bg-ink/5 hover:text-ink"
          onClick={clearFilters}
        >
          <XIcon class="size-3.5" />
        </button>
      </Show>
    </div>
  );
};

const EMAIL_IMPORTANCE_OPTIONS: Option[] = [
  { value: 'signal', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
];

function importanceToOption(importance: boolean | null | undefined): Option[] {
  if (importance === true) return [EMAIL_IMPORTANCE_OPTIONS[0]];
  if (importance === false) return [EMAIL_IMPORTANCE_OPTIONS[1]];
  return [];
}

const EmailImportanceFilter = () => {
  const { setQueryFilters, queryFilters } = useSoupView();

  const active = createMemo(() =>
    importanceToOption(queryFilters().email_filters?.importance)
  );

  const label = createMemo(() => {
    const a = active();
    const value = a.length > 0 ? a[0].label : 'All';
    return `Importance: ${value}`;
  });

  const handleChange = (selected: Option[]) => {
    const importance =
      selected.length > 0 ? selected[0].value === 'signal' : undefined;
    setQueryFilters((prev) => ({
      ...prev,
      email_filters: {
        ...prev.email_filters,
        importance,
      },
    }));
  };

  return (
    <FilterSelect
      label={label()}
      options={EMAIL_IMPORTANCE_OPTIONS}
      active={active()}
      onChange={handleChange}
      multiple={false}
    />
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
          <div class="size-4">
            <EntityIconWithAvatar entity={ch.data} />
          </div>
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
