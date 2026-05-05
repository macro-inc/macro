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
  NIL_UUID,
  defineQueryFilters,
  type Query,
} from '@app/component/next-soup/filters/filter-store';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  type JSX,
} from 'solid-js';
import type {
  ChannelFilters,
  EmailFilters,
} from '@service-storage/generated/schemas';

export type SearchableOption = {
  id: string;
  label: string;
  icon?: () => JSX.Element;
};

/**
 * Picker for the "In" chip (channels + DMs). Used by channel-message and
 * call-record search.
 */
function useChannelPicker() {
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');

  const options = createMemo((): SearchableOption[] =>
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

  const labelMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const opt of options()) map.set(opt.id, opt.label);
    return map;
  });

  return { options, labelMap };
}

/**
 * Picker for the "From" chip (people). Used by channel-message sender
 * filter and call-record speaker filter.
 */
function usePersonPicker() {
  const { useList } = useQuickAccess();
  const currentUserId = useUserId();
  const people = useList('person');

  const options = createMemo((): SearchableOption[] => {
    const uid = currentUserId();
    let me: SearchableOption | undefined;
    const others: SearchableOption[] = [];
    for (const s of people()) {
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

  const labelMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const opt of options()) map.set(opt.id, opt.label);
    return map;
  });

  return { options, labelMap };
}

/**
 * Shared options + label maps for the In (channel) and From (person)
 * search-filter chips. Both are reused across channel-message and
 * call-record search.
 */
export function useSearchFilterOptions() {
  const channel = useChannelPicker();
  const person = usePersonPicker();

  return {
    channelOptions: channel.options,
    channelLabelMap: channel.labelMap,
    senderOptions: person.options,
    senderLabelMap: person.labelMap,
  };
}

export type ChannelSubFilters = Pick<
  ChannelFilters,
  'channel_ids' | 'sender_ids'
>;
export type EmailSubFilters = Pick<EmailFilters, 'importance'>;
export type CallSubFilters = {
  channel_ids?: string[];
  speaker_ids?: string[];
  attended?: boolean | null;
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

export function getCachedCallSubFilters(contentId: string): CallSubFilters {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return {};
  try {
    const raw = localStorage.getItem(
      soupViewCacheKey(contentId, 'call-sub-filters')
    );
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function cacheCallSubFilters(
  contentId: string,
  filters: CallSubFilters
) {
  if ((activeSoupViewCounts.get(contentId) ?? 0) > 1) return;
  try {
    localStorage.setItem(
      soupViewCacheKey(contentId, 'call-sub-filters'),
      JSON.stringify(filters)
    );
  } catch {
    // best-effort
  }
}

type SearchFilterHookOpts = {
  contentId: string;
  isSearchView: Accessor<boolean>;
};

/** Channel-message search filters (in:, from:). */
export function useChannelSearchFilter(opts: SearchFilterHookOpts) {
  const { soup, queryFilters } = useSoupView();
  const { changeIndex } = useSearchIndexController();

  const isActive = () => soup.predicates.isActive('channels');

  const channelIds = createMemo(
    () => queryFilters.state.include.channelId ?? []
  );
  const senderIds = createMemo(
    () => queryFilters.state.include?.channelSenderId ?? []
  );

  createEffect(() => {
    if (!opts.isSearchView() || !isActive()) return;
    const sub: ChannelSubFilters = {};
    if (channelIds().length) sub.channel_ids = channelIds();
    if (senderIds().length) sub.sender_ids = senderIds();
    cacheChannelSubFilters(opts.contentId, sub);
  });

  return {
    isActive,
    channelIds,
    setChannelIds: (ids: string[]) => {
      if (!isActive()) changeIndex('channels');
      queryFilters.set({
        include: {
          channelId: ids,
        },
      });
    },
    senderIds,
    setSenderIds: (ids: string[]) => {
      if (!isActive()) changeIndex('channels');

      queryFilters.set({
        include: {
          channelSenderId: ids,
        },
      });
    },
  };
}

/** Email search filters (importance). */
export function useEmailSearchFilter(opts: SearchFilterHookOpts) {
  const { soup, queryFilters } = useSoupView();
  const { changeIndex } = useSearchIndexController();

  const isActive = () => soup.predicates.isActive('email');
  const importance = createMemo(
    () => queryFilters.state.include.emailImportance
  );

  const setImportance = (val: boolean | undefined) =>
    batch(() => {
      if (!isActive()) changeIndex('email');
      queryFilters.set({
        include: {
          emailImportance: val,
        },
        exclude: {
          emailImportance: undefined,
        },
      });
    });

  createEffect(() => {
    if (!opts.isSearchView() || !isActive()) return;
    cacheEmailSubFilters(opts.contentId, { importance: importance() ?? null });
  });

  return { isActive, importance, setImportance };
}

type CallFieldMap = {
  callChannelId: string[] | undefined;
  callSpeakerId: string[] | undefined;
  callAttended: boolean | undefined;
};

/** Call-record search filters (in:, from:, attended). */
export function useCallSearchFilter(opts: SearchFilterHookOpts) {
  const { soup, queryFilters } = useSoupView();
  const { changeIndex } = useSearchIndexController();

  const isActive = () => soup.predicates.isActive('calls');
  const mutate = <K extends keyof CallFieldMap>(
    field: K,
    value: CallFieldMap[K]
  ) =>
    batch(() => {
      if (!isActive()) changeIndex('calls');
      queryFilters.set({
        include: {
          [field]: value,
        },
      });
    });

  const channelIds = createMemo(
    () => queryFilters.state.include.callChannelId ?? []
  );
  const speakerIds = createMemo(
    () => queryFilters.state.include.callSpeakerId ?? []
  );
  const attended = createMemo(() => queryFilters.state.include.callAttended);

  createEffect(() => {
    if (!opts.isSearchView() || !isActive()) return;
    const sub: CallSubFilters = {};
    if (channelIds().length) sub.channel_ids = channelIds();
    if (speakerIds().length) sub.speaker_ids = speakerIds();
    if (attended() !== undefined && attended() !== null)
      sub.attended = attended();
    cacheCallSubFilters(opts.contentId, sub);
  });

  return {
    isActive,
    channelIds,
    setChannelIds: (ids: string[]) =>
      mutate('callChannelId', ids.length ? ids : undefined),
    speakerIds,
    setSpeakerIds: (ids: string[]) =>
      mutate('callSpeakerId', ids.length ? ids : undefined),
    attended,
    setAttended: (val: boolean | undefined) => mutate('callAttended', val),
  };
}

export function useSearchIndexController() {
  const { soup, queryFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contentId = panel.handle.content().id;

  const changeIndex = (newValue: string) => {
    batch(() => {
      for (const opt of INDEX_OPTIONS) {
        if (soup.predicates.isActive(opt.value)) {
          soup.predicates.toggle({ or: [opt.value as FilterID] });
        }
      }

      if (newValue === 'all') {
        cacheChannelSubFilters(contentId, {});
        queryFilters.replace({ include: { emailImportance: true } });
        return;
      }

      const opt = INDEX_OPTIONS.find((o) => o.value === newValue);
      if (!opt) return;
      soup.predicates.toggle({ or: [opt.value as FilterID] });

      if (opt.value === 'channels') {
        const cached = getCachedChannelSubFilters(contentId);

        queryFilters.replace({
          include: {
            ...opt.queryFilters.include,
            channelId: cached.channel_ids,
            channelSenderId: cached.sender_ids,
          },
          exclude: opt.queryFilters.exclude,
        });
      } else if (opt.value === 'email') {
        const cached = getCachedEmailSubFilters(contentId);
        const importance =
          'importance' in cached
            ? (cached.importance ?? undefined)
            : opt.queryFilters.include?.emailImportance;

        queryFilters.replace({
          include: {
            ...opt.queryFilters.include,
            emailImportance: importance,
          },
          exclude: opt.queryFilters.exclude,
        });
      } else if (opt.value === 'calls') {
        const cached = getCachedCallSubFilters(contentId);
        const attended =
          'attended' in cached
            ? (cached.attended ?? undefined)
            : opt.queryFilters.include?.callAttended;

        queryFilters.replace({
          include: {
            ...opt.queryFilters.include,
            callChannelId: cached.channel_ids,
            callSpeakerId: cached.speaker_ids,
            callAttended: attended,
          },
          exclude: opt.queryFilters.exclude,
        });
      } else {
        queryFilters.replace({
          include: opt.queryFilters.include,
          exclude: opt.queryFilters.exclude,
        });
      }
    });
  };

  return { changeIndex };
}

export const INDEX_OPTIONS: {
  label: string;
  value: string;
  icon: () => JSX.Element;
  queryFilters: Query;
}[] = [
  {
    value: 'channels',
    label: 'Channels',
    icon: () => (
      <EntityIcon targetType="channel" size="xs" theme="monochrome" />
    ),
    queryFilters: defineQueryFilters({ exclude: { channelId: [NIL_UUID] } }),
  },
  {
    value: 'document-or-file',
    label: 'Documents',
    icon: () => <EntityIcon targetType="md" size="xs" theme="monochrome" />,
    queryFilters: defineQueryFilters({ exclude: { subType: ['task'] } }),
  },
  {
    value: 'task',
    label: 'Tasks',
    icon: () => <EntityIcon targetType="task" size="xs" theme="monochrome" />,
    queryFilters: defineQueryFilters({ include: { subType: ['task'] } }),
  },
  {
    value: 'email',
    label: 'Email',
    icon: () => <EntityIcon targetType="email" size="xs" theme="monochrome" />,
    queryFilters: defineQueryFilters({
      include: { emailImportance: true },
    }),
  },
  {
    value: 'calls',
    label: 'Calls',
    icon: () => <EntityIcon targetType="call" size="xs" theme="monochrome" />,
    queryFilters: defineQueryFilters({}, { skipTargets: ['callf'] }),
  },
  {
    value: 'folders',
    label: 'Folders',
    icon: () => (
      <EntityIcon targetType="project" size="xs" theme="monochrome" />
    ),
    queryFilters: defineQueryFilters({ exclude: { folderId: [NIL_UUID] } }),
  },
  {
    value: 'agent',
    label: 'Agents',
    icon: () => <EntityIcon targetType="chat" size="xs" theme="monochrome" />,
    queryFilters: defineQueryFilters({ exclude: { chatId: [NIL_UUID] } }),
  },
];
