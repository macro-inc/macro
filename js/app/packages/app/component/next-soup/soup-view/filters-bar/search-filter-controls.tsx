import XIcon from '@icon/regular/x.svg';
import { EntityIcon } from '@core/component/EntityIcon';
import { EntityIcon as EntityIconWithAvatar } from '@entity/extractors/entity-icon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  soupViewCacheKey,
  activeSoupViewCounts,
} from '@app/component/next-soup/soup-view/soup-view-cache-key';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { batch, createEffect, createMemo, createSignal, Show } from 'solid-js';
import { FilterCombobox, FilterSelect, type Option } from './filter-primitives';
import type { FilterID } from '@app/component/next-soup/filters/configs/';
import { NIL } from '@app/component/next-soup/filters/filter-store';

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

export const INDEX_OPTIONS: Option[] = [
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

export const SearchIndexFilter = () => {
  const { soup, setFilters, filters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;

  // Initialize from soup.filters state
  const initialIndex = INDEX_OPTIONS.find((opt) =>
    soup.filters.isActive(opt.value)
  );
  const [selectedIndex, setSelectedIndex] = createSignal<string | null>(
    initialIndex?.value ?? null
  );

  const activeIndex = createMemo((): Option[] => {
    const value = selectedIndex();
    if (!value) return [];
    const found = INDEX_OPTIONS.find((opt) => opt.value === value);
    return found
      ? [{ value: found.value, label: found.label, icon: found.icon }]
      : [];
  });

  const isChannelsActive = () =>
    activeIndex().some((o) => o.value === 'channels');
  const isEmailActive = () => activeIndex().some((o) => o.value === 'email');

  createEffect(() => {
    if (!isEmailActive()) return;
    const importance = filters().include.emailImportance?.[0];
    // Use null as sentinel for "explicitly cleared" since undefined is dropped by JSON.stringify
    cacheEmailSubFilters(contentId, { importance: importance ?? null });
  });

  const handleChange = (selected: Option[]) => {
    const newValue = selected.length > 0 ? selected[0].value : null;
    setSelectedIndex(newValue);

    batch(() => {
      for (const opt of INDEX_OPTIONS) {
        if (soup.filters.isActive(opt.value)) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
        }
      }

      if (newValue) {
        soup.filters.toggle({ or: [newValue as FilterID] });

        // Set filter store based on index type
        if (newValue === 'channels') {
          const cached = getCachedChannelSubFilters(contentId);
          setFilters((d) => {
            d.exclude.channelId = [NIL];
            if (cached.channel_ids?.length) {
              d.include.channelId = cached.channel_ids;
            }
            if (cached.sender_ids?.length) {
              d.include.channelSenderId = cached.sender_ids;
            }
          });
        } else if (newValue === 'email') {
          const cached = getCachedEmailSubFilters(contentId);
          setFilters((d) => {
            d.exclude.threadId = [NIL];
            if (cached.importance !== undefined && cached.importance !== null) {
              d.include.emailImportance = [cached.importance];
            }
          });
        } else if (newValue === 'task') {
          setFilters((d) => {
            d.include.subType = ['task'];
          });
        } else if (newValue === 'document-or-file') {
          setFilters((d) => {
            d.exclude.subType = ['task'];
          });
        } else if (newValue === 'folders') {
          setFilters((d) => {
            d.exclude.folderId = [NIL];
          });
        } else if (newValue === 'agent') {
          setFilters((d) => {
            d.exclude.chatId = [NIL];
          });
        }
      } else {
        // Clear all filters
        setFilters((d) => {
          d.include = {};
          d.exclude = {};
          d.properties = [];
          d.emailView = undefined;
        });
      }
    });
  };

  const indexLabel = createMemo(() => {
    const active = activeIndex();
    const value = active.length > 0 ? active[0].label : 'All';
    return `Type: ${value}`;
  });

  const hasActiveIndex = () => selectedIndex() !== null;

  const clearFilters = () => {
    cacheChannelSubFilters(contentId, {});
    handleChange([]);
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label={indexLabel()}
        options={INDEX_OPTIONS}
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
  const { filters, setFilters } = useSoupView();

  const active = createMemo(() => {
    const importance = filters().include.emailImportance?.[0];
    return importanceToOption(importance);
  });

  const label = createMemo(() => {
    const a = active();
    const value = a.length > 0 ? a[0].label : 'All';
    return `Importance: ${value}`;
  });

  const handleChange = (selected: Option[]) => {
    const importance =
      selected.length > 0 ? selected[0].value === 'signal' : undefined;
    setFilters((d) => {
      if (importance !== undefined) {
        d.include.emailImportance = [importance];
      } else {
        delete d.include.emailImportance;
      }
    });
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
  const { filters, setFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');

  const channelIds = () => filters().include.channelId ?? [];

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
    const ids = channelIds();
    if (ids.length === 0) return [];
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

    // Update cache for persistence
    const cached = getCachedChannelSubFilters(contentId);
    cacheChannelSubFilters(contentId, {
      ...cached,
      channel_ids: ids.length > 0 ? ids : undefined,
    });

    // Update filter store
    setFilters((d) => {
      if (ids.length > 0) {
        d.include.channelId = ids;
      } else {
        delete d.include.channelId;
      }
    });
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
  const { filters, setFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;
  const { useList } = useQuickAccess();
  const contacts = useList('person');
  const userId = useUserId();

  const senderIds = () => filters().include.channelSenderId ?? [];

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
    const ids = senderIds();
    if (ids.length === 0) return [];
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

    // Update cache for persistence
    const cached = getCachedChannelSubFilters(contentId);
    cacheChannelSubFilters(contentId, {
      ...cached,
      sender_ids: ids.length > 0 ? ids : undefined,
    });

    // Update filter store
    setFilters((d) => {
      if (ids.length > 0) {
        d.include.channelSenderId = ids;
      } else {
        delete d.include.channelSenderId;
      }
    });
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
