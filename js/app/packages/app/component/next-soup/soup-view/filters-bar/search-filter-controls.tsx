import { EntityIcon } from '@core/component/EntityIcon';
import { EntityIcon as EntityIconWithAvatar } from '@entity/extractors/entity-icon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  soupViewCacheKey,
  activeSoupViewCounts,
} from '@app/component/next-soup/soup-view/soup-view-cache-key';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import {
  NIL,
  defineQueryFilters,
  applyFilterData,
  type FilterData,
} from '@app/component/next-soup/filters/filter-store';
import { batch, createMemo, type JSX } from 'solid-js';
import type { Option } from './filter-primitives';

export type SearchableOption = {
  id: string;
  label: string;
  icon?: () => JSX.Element;
};

/**
 * Shared option accessors for search view's In/From pickers. Used both by the
 * Filter menu submenus and by the active-filter chips.
 */
export function useSearchFilterOptions() {
  const { useList } = useQuickAccess();
  const currentUserId = useUserId();
  const channels = useList('channel', 'dm');
  const senders = useList('person');

  const channelOptions = createMemo((): SearchableOption[] =>
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

  const senderOptions = createMemo((): SearchableOption[] => {
    const uid = currentUserId();
    let me: SearchableOption | undefined;
    const others: SearchableOption[] = [];
    for (const s of senders()) {
      const opt: SearchableOption = {
        id: s.id,
        label:
          s.id === uid ? `${s.data.name || 'Me'} (me)` : s.data.name || s.id,
        icon: () => (
          <UserIcon id={s.id} size="xs" suppressClick showTooltip={false} />
        ),
      };
      if (s.id === uid) me = opt;
      else others.push(opt);
    }
    return [...(me ? [me] : []), ...others];
  });

  return { channelOptions, senderOptions };
}

export type ChannelSubFilters = {
  channel_ids?: string[];
  sender_ids?: string[];
};
export type EmailSubFilters = {
  importance?: boolean | null;
};

export function getCachedChannelSubFilters(
  contentId: string
): ChannelSubFilters {
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

export function cacheChannelSubFilters(
  contentId: string,
  filters: ChannelSubFilters
) {
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

export function getCachedEmailSubFilters(contentId: string): EmailSubFilters {
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

export function cacheEmailSubFilters(
  contentId: string,
  filters: EmailSubFilters
) {
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

type IndexOption = Option & { filterData: Partial<FilterData> };

export const INDEX_OPTIONS: IndexOption[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => (
      <EntityIcon targetType="channel" size="xs" theme="monochrome" />
    ),
    filterData: defineQueryFilters({
      exclude: { channelId: [NIL] },
    }),
  },
  {
    value: 'document-or-file',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" theme="monochrome" />,
    filterData: defineQueryFilters({
      exclude: { subType: ['task'] },
    }),
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" theme="monochrome" />,
    filterData: defineQueryFilters({
      include: { subType: ['task'] },
    }),
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" theme="monochrome" />,
    filterData: defineQueryFilters({
      exclude: { threadId: [NIL] },
      include: { emailImportance: [true] },
    }),
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => (
      <EntityIcon targetType="project" size="xs" theme="monochrome" />
    ),
    filterData: defineQueryFilters({
      exclude: { folderId: [NIL] },
    }),
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" theme="monochrome" />,
    filterData: defineQueryFilters({
      exclude: { chatId: [NIL] },
    }),
  },
];

export function useSearchIndexController() {
  const { soup, setFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;

  const changeIndex = (newValue: string) => {
    batch(() => {
      for (const opt of INDEX_OPTIONS) {
        if (soup.filters.isActive(opt.value)) {
          soup.filters.toggle({ or: [opt.value as FilterID] });
        }
      }

      if (newValue === 'all') {
        cacheChannelSubFilters(contentId, {});
        setFilters((d) => {
          applyFilterData(d, {});
          d.include.emailImportance = [true];
        });
        return;
      }

      const opt = INDEX_OPTIONS.find((o) => o.value === newValue);
      if (!opt) return;
      soup.filters.toggle({ or: [opt.value as FilterID] });

      if (opt.value === 'channels') {
        const cached = getCachedChannelSubFilters(contentId);
        setFilters((d) => {
          applyFilterData(d, opt.filterData);
          if (cached.channel_ids?.length) {
            d.include.channelId = cached.channel_ids;
          }
          if (cached.sender_ids?.length) {
            d.include.channelSenderId = cached.sender_ids;
          }
        });
      } else if (opt.value === 'email') {
        const cached = getCachedEmailSubFilters(contentId);
        const importance =
          'importance' in cached
            ? (cached.importance ?? undefined)
            : opt.filterData.include?.emailImportance?.[0];
        setFilters((d) => {
          applyFilterData(d, opt.filterData);
          if (importance !== undefined) {
            d.include.emailImportance = [importance];
          } else {
            delete d.include.emailImportance;
          }
        });
      } else {
        setFilters((d) => {
          applyFilterData(d, opt.filterData);
        });
      }
    });
  };

  return { changeIndex };
}
