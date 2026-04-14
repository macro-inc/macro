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
import { batch, createMemo, createSignal, Show } from 'solid-js';
import { FilterCombobox, FilterSelect, type Option } from './filter-primitives';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import {
  ast,
  channelIdsToAst,
  senderIdsToAst,
  type FilterAst,
} from '@app/component/next-soup/filters';

type ChannelSubFilters = { channel_ids?: string[]; sender_ids?: string[] };

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

const NIL = '00000000-0000-0000-0000-000000000000';

export const INDEX_OPTIONS: (Option & { ast: FilterAst })[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => (
      <EntityIcon targetType="channel" size="xs" theme="monochrome" />
    ),
    ast: { chanf: ast.neq('ChannelId', NIL) },
  },
  {
    value: 'document-or-file',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" theme="monochrome" />,
    ast: { df: ast.neq('dst', 'task') },
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" theme="monochrome" />,
    ast: { df: ast.eq('dst', 'task') },
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" theme="monochrome" />,
    ast: { ef: ast.neq('ThreadId', NIL) },
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => (
      <EntityIcon targetType="project" size="xs" theme="monochrome" />
    ),
    ast: { pf: ast.neq('ProjectId', NIL) },
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" theme="monochrome" />,
    ast: { cf: ast.neq('ChatId', NIL) },
  },
];

const INDEX_SELECT_OPTIONS: Option[] = INDEX_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  icon: o.icon,
}));

export const SearchIndexFilter = () => {
  const { soup, filterAst } = useSoupView();
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

  const isChannelsActive = () => selectedIndex() === 'channels';

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
        const opt = INDEX_OPTIONS.find((o) => o.value === newValue);
        if (opt) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
          if (opt.value === 'channels') {
            const cached = getCachedChannelSubFilters(contentId);
            // Build AST with cached channel/sender filters
            const channelAst = channelIdsToAst(cached.channel_ids ?? []);
            const senderAst = senderIdsToAst(cached.sender_ids ?? []);
            filterAst.set({
              ...opt.ast,
              ...channelAst,
              ...senderAst,
            });
          } else {
            filterAst.set(opt.ast);
          }
        }
      } else {
        filterAst.set({});
      }
    });
  };

  const indexLabel = createMemo(() => {
    const active = activeIndex();
    return active.length > 0 ? active[0].label : 'All';
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
        options={INDEX_SELECT_OPTIONS}
        active={activeIndex()}
        onChange={handleChange}
        multiple={false}
      />
      <Show when={isChannelsActive()}>
        <InChannelFilter />
        <FromSenderFilter />
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

const InChannelFilter = () => {
  const { filterAst } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');

  // Initialize from cache, use signal for reactivity
  const [channelIds, setChannelIds] = createSignal<string[]>(
    getCachedChannelSubFilters(contentId).channel_ids ?? []
  );

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

    // Update signal for UI reactivity
    setChannelIds(ids);

    // Update cache for persistence
    const cached = getCachedChannelSubFilters(contentId);
    cacheChannelSubFilters(contentId, {
      ...cached,
      channel_ids: ids.length > 0 ? ids : undefined,
    });

    // Rebuild chanf from new channel IDs and existing sender IDs
    const senderIds = cached.sender_ids ?? [];
    filterAst.update((draft) => {
      const channelAst = channelIdsToAst(ids);
      const senderAst = senderIdsToAst(senderIds);
      if (channelAst.chanf && senderAst.chanf) {
        draft.chanf = ast.or(channelAst.chanf, senderAst.chanf);
      } else {
        draft.chanf = channelAst.chanf ?? senderAst.chanf;
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
  const { filterAst } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;
  const { useList } = useQuickAccess();
  const contacts = useList('person');
  const userId = useUserId();

  // Initialize from cache, use signal for reactivity
  const [senderIds, setSenderIds] = createSignal<string[]>(
    getCachedChannelSubFilters(contentId).sender_ids ?? []
  );

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

    // Update signal for UI reactivity
    setSenderIds(ids);

    // Update cache for persistence
    const cached = getCachedChannelSubFilters(contentId);
    cacheChannelSubFilters(contentId, {
      ...cached,
      sender_ids: ids.length > 0 ? ids : undefined,
    });

    // Rebuild chanf from existing channel IDs and new sender IDs
    const channelIds = cached.channel_ids ?? [];
    filterAst.update((draft) => {
      const channelAst = channelIdsToAst(channelIds);
      const senderAst = senderIdsToAst(ids);
      if (channelAst.chanf && senderAst.chanf) {
        draft.chanf = ast.or(channelAst.chanf, senderAst.chanf);
      } else {
        draft.chanf = channelAst.chanf ?? senderAst.chanf;
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
