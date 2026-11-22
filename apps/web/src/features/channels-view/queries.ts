import type { ListDataSource } from '@app/components/list';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useFlow, usePending } from '@app/observability/flow';
import { useUserId } from '@core/context/user';
import {
  type ChannelEntity,
  type EntityData,
  isChannelEntity,
  isChannelThreadEntity,
} from '@entity';
import type { QueryAccount } from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import {
  registerChannelListNotificationRefresh,
  useCachedChannelsByIds,
} from '@queries/channel/by-ids';
import { fetchAllChannels } from '@queries/channel/channels';
import {
  type SoupAstItemsQueryArgs,
  type SoupAstParams,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createEffect, createMemo, on, untrack } from 'solid-js';
import { sortChannels } from './core/channel-sort';
import { channelThreadsQueryArgs } from './core/channel-threads-query';
import { channelTypesShownBy } from './core/channel-types';
import {
  channelLookupLoad,
  soupListLoad,
  traceChannelListLoad,
} from './queries/channel-list-load-trace';
import type {
  ChannelListSort,
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsSortGroup,
} from './types';
import { channelHasMessages, isDirectMessage, isTeamChannel } from './utils';

/**
 * Threads the Threads rail reads on its own to find their channels: one Soup
 * page at its largest size. A few busy channels can fill a smaller page,
 * leaving a list too short to scroll; scrolling the rail loads the rest.
 */
export const THREAD_CHANNELS_LIMIT = 500;

const CHANNELS_QUERY_PARAMS = {
  limit: 100,
} satisfies SoupAstParams;

type ChannelsQueryDefinition = {
  params: SoupAstParams;
  filters: ReturnType<typeof defineQueryFilters>;
  matches: (channel: ChannelEntity) => boolean;
};

export type ChannelsDataSource = ListDataSource<ChannelEntity>;

/** Scopes backed by a channel list query. */
type ChannelsListScope = ChannelsQueryScope | 'search';

export type ChannelsSourceScope = ChannelsListScope | 'threads';

type ChannelListSnapshot = {
  account: QueryAccount | undefined;
  items: ChannelEntity[];
  source: 'shared-list' | 'soup' | 'none';
};
export type ChannelsSources = Record<ChannelsSourceScope, ChannelsDataSource>;

export const CHANNELS_QUERY_DEFINITIONS = {
  recents: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: {
        channelImportance: true,
        channelIsParticipant: [true],
      },
    }),
    matches: channelHasMessages,
  },
  team_channels: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'created_at' },
    filters: defineQueryFilters({
      include: { channelType: ['team'], channelIsParticipant: [true] },
    }),
    matches: isTeamChannel,
  },
  channels: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'created_at' },
    filters: defineQueryFilters({
      include: { channelIsParticipant: [true] },
      exclude: { channelType: ['direct_message', 'team'] },
    }),
    matches: (channel) => !isDirectMessage(channel) && !isTeamChannel(channel),
  },
  direct_messages: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: {
        channelType: ['direct_message'],
        channelIsParticipant: [true],
      },
    }),
    matches: isDirectMessage,
  },
  search: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: { channelIsParticipant: [true] },
    }),
    matches: () => true,
  },
} satisfies Record<ChannelsListScope, ChannelsQueryDefinition>;

export function channelsQueryArgs(
  scope: ChannelsListScope,
  sortMethod?: ChannelListSort
): SoupAstItemsQueryArgs {
  const definition = CHANNELS_QUERY_DEFINITIONS[scope];

  return {
    params: {
      ...definition.params,
      sort_method: sortMethod ?? definition.params.sort_method,
    },
    body: compileToAst(queryStateFrom(definition.filters)),
  };
}

export function filterChannelsForScope(
  scope: ChannelsListScope,
  channels: readonly ChannelEntity[]
): ChannelEntity[] {
  return channels.filter(CHANNELS_QUERY_DEFINITIONS[scope].matches);
}

/** Resolve full built-in membership without changing the rail's loaded pages. */
export async function fetchChannelGroupIds(
  group: ChannelsGroup,
  excludedIds: readonly string[],
  signal?: AbortSignal
): Promise<string[]> {
  const excluded = new Set(excludedIds);
  const channels = await fetchAllChannels(signal);
  const members = channels.filter((channel) => {
    if (!channel.is_participant || excluded.has(channel.id)) {
      return false;
    }

    if (group === 'team_channels') {
      return channel.channel_type === 'team';
    }

    if (group === 'direct_messages') {
      return channel.channel_type === 'direct_message';
    }

    return (
      channel.channel_type !== 'team' &&
      channel.channel_type !== 'direct_message'
    );
  });

  return [...new Set(members.map((channel) => channel.id))];
}

export function deduplicateChannels(
  collections: readonly (readonly ChannelEntity[])[]
): ChannelEntity[] {
  const channelsById = new Map<string, ChannelEntity>();

  for (const channels of collections) {
    for (const channel of channels) {
      if (!channelsById.has(channel.id)) {
        channelsById.set(channel.id, channel);
      }
    }
  }

  return [...channelsById.values()];
}

export function resolveSelectedChannel(
  selectedChannelId: string | undefined,
  loadedChannels: readonly ChannelEntity[],
  fallbackEntities: readonly EntityData[] = []
): ChannelEntity | undefined {
  if (selectedChannelId === undefined) return;

  return (
    loadedChannels.find((channel) => channel.id === selectedChannelId) ??
    fallbackEntities.find(
      (entity): entity is ChannelEntity =>
        isChannelEntity(entity) && entity.id === selectedChannelId
    )
  );
}

/**
 * The Threads rail: channels and DMs holding threads the user takes part in.
 * Channels have no thread filter, so the rail pages through the user's
 * threads and loads the distinct channels they belong to.
 */
function useThreadChannelsDataSource(
  enabled: Accessor<boolean>,
  sortMethod: Accessor<ChannelListSort>
): ChannelsDataSource {
  const userId = useUserId();
  const threadsEnabled = () => enabled() && Boolean(userId());
  // The filter is compiled once per viewer: Soup reads its arguments from
  // several computations.
  const threadsArgs = createMemo(() => {
    const args = channelThreadsQueryArgs(userId() ?? '', undefined);
    return {
      ...args,
      params: { ...args.params, limit: THREAD_CHANNELS_LIMIT },
    };
  });
  const threadsQuery = useSoupAstItemsQuery(threadsArgs, () => ({
    enabled: threadsEnabled(),
    staleTime: 30_000,
  }));
  const channelIds = createMemo<string[]>((previous) => {
    if (!threadsQuery.isEnabled || threadsQuery.isLoading) return previous;
    const ids = new Set<string>();
    for (const entity of threadsQuery.data?.entities ?? []) {
      if (isChannelThreadEntity(entity) && !entity.deletedAt)
        ids.add(entity.channelId);
    }
    return [...ids];
  }, []);
  // Channels already in the cache render at once; one bounded request per
  // batch fetches the rest, however many channels hold threads.
  const lookup = useCachedChannelsByIds(channelIds, threadsEnabled);
  const items = createMemo<ChannelEntity[]>((previous) => {
    if (channelIds().length === 0) return [];
    const resolved = lookup.channels();
    // A changed ID set starts a new lookup. Keep the rows on screen until it
    // resolves a channel, from the cache or the network.
    if (resolved.length === 0 && lookup.isLoading()) return previous;
    const byId = new Map(resolved.map((channel) => [channel.id, channel]));
    return sortChannels(
      channelIds().flatMap((id) => byId.get(id) ?? []),
      sortMethod()
    );
  }, []);
  const isLoading = () =>
    items().length === 0 &&
    ((threadsQuery.isEnabled && threadsQuery.isLoading) || lookup.isLoading());
  usePending('channels.sidebar.threads.render', isLoading);
  traceChannelListLoad('threads', () => soupListLoad(threadsQuery));
  traceChannelListLoad('thread_channels', () =>
    channelLookupLoad(lookup, threadsEnabled())
  );

  return {
    items,
    isLoading,
    isFetching: () =>
      (threadsQuery.isEnabled && threadsQuery.isFetching) || lookup.isLoading(),
    error: () =>
      (threadsQuery.isEnabled ? threadsQuery.error : null) ??
      lookup.error() ??
      undefined,
    hasMore: () => threadsQuery.isEnabled && threadsQuery.hasNextPage,
    isLoadingMore: () =>
      threadsQuery.isEnabled && threadsQuery.isFetchingNextPage,
    loadMore: async () => {
      if (
        !threadsQuery.isEnabled ||
        threadsQuery.isFetchingNextPage ||
        !threadsQuery.hasNextPage
      )
        return;
      await threadsQuery.fetchNextPage();
    },
    refresh: async () => {
      if (!threadsQuery.isEnabled) return;
      await threadsQuery.refresh();
    },
  };
}

function useChannelsDataSource(
  scope: ChannelsListScope,
  enabled: Accessor<boolean>,
  sortMethod: Accessor<ChannelListSort | undefined>,
  cachedChannels: Accessor<readonly ChannelEntity[]>
): ChannelsDataSource {
  const account = useQueryAccount();
  const sourceEnabled = () => enabled() && account() !== undefined;
  const query = useSoupAstItemsQuery(
    () => channelsQueryArgs(scope, sortMethod()),
    () => ({
      enabled: sourceEnabled(),
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  const isEnabled = () => sourceEnabled() && query.isEnabled;
  const cachedItems = createMemo(() => {
    if (!sourceEnabled()) return [];
    if (query.hasPageData) return [];
    const channels = cachedChannels().filter(
      (channel) => channel.isParticipant !== false
    );
    return sortChannels(
      filterChannelsForScope(scope, channels),
      sortMethod() ?? CHANNELS_QUERY_DEFINITIONS[scope].params.sort_method
    ).slice(0, CHANNELS_QUERY_PARAMS.limit);
  });
  registerChannelListNotificationRefresh(
    query,
    channelTypesShownBy(CHANNELS_QUERY_DEFINITIONS[scope].filters)
  );
  const snapshot = createMemo<ChannelListSnapshot>(
    (previous) => {
      const owner = account();
      const sameAccount =
        owner !== undefined &&
        previous.account?.userId === owner.userId &&
        previous.account.session === owner.session;
      const previousItems = sameAccount ? previous.items : [];
      if (!owner || !isEnabled())
        return { account: owner, items: [], source: 'none' };
      const data = query.isPending ? undefined : query.data;
      const seeded = !query.hasPageData;
      const cached = seeded ? cachedItems() : [];
      if (data === undefined && cached.length === 0) {
        return {
          account: owner,
          items: previousItems,
          source: previousItems.length ? previous.source : 'none',
        };
      }
      // A partial local index can enrich the seed but cannot remove its rows.
      // Only a cached or fetched page for this input establishes membership.
      const local = (data?.entities ?? []).filter(isChannelEntity);
      const channels = filterChannelsForScope(
        scope,
        seeded ? deduplicateChannels([local, cached]) : local
      );
      const sorted =
        scope === 'recents' && !seeded
          ? channels
          : sortChannels(
              channels,
              sortMethod() ??
                CHANNELS_QUERY_DEFINITIONS[scope].params.sort_method
            );
      let source: ChannelListSnapshot['source'] = 'soup';
      if (cached.length) source = 'shared-list';
      else if (seeded && channels.length === 0) source = 'none';
      return {
        account: owner,
        source,
        items: seeded ? sorted.slice(0, CHANNELS_QUERY_PARAMS.limit) : sorted,
      };
    },
    { account: undefined, items: [], source: 'none' }
  );
  const items = () => snapshot().items;
  const flow = useFlow();
  let recordedDisplay = false;
  createEffect(
    on(
      () => [isEnabled(), snapshot()] as const,
      ([active, display]) => {
        if (!active) {
          recordedDisplay = false;
          return;
        }
        if (recordedDisplay || display.source === 'none') return;
        recordedDisplay = true;
        const cacheHit =
          display.source === 'shared-list' ||
          !query.hasPageData ||
          query.isFetching;
        let source = 'network';
        if (display.source === 'shared-list') source = 'shared-list';
        else if (cacheHit) source = 'normalized';
        flow.span.setAttr(`channels.sidebar.${scope}.cache_hit`, cacheHit);
        flow.span.setAttr(`channels.sidebar.${scope}.source`, source);
        flow.span.setAttr(
          `channels.sidebar.${scope}.rows`,
          display.items.length
        );
      }
    )
  );
  usePending(
    `channels.sidebar.${scope}.render`,
    () => isEnabled() && query.isLoading && items().length === 0
  );

  return {
    items,
    isLoading: () => isEnabled() && query.isLoading && items().length === 0,
    isFetching: () => isEnabled() && query.isFetching,
    // The live query hides a network failure behind its local cache rows,
    // which are empty when the list was never cached. An empty list after a
    // failed fetch is unknown, not "no conversations".
    error: () => {
      if (!isEnabled()) return undefined;
      return (
        query.error ??
        (items().length === 0 || snapshot().source === 'shared-list'
          ? query.fetchError
          : null) ??
        undefined
      );
    },
    hasMore: () => isEnabled() && query.hasNextPage,
    isLoadingMore: () => isEnabled() && query.isFetchingNextPage,
    loadMore: async () => {
      if (!isEnabled() || query.isFetchingNextPage || !query.hasNextPage) {
        return;
      }

      await query.fetchNextPage();
    },
    refresh: async () => {
      if (!isEnabled()) return;
      await query.refresh();
    },
  };
}

function createAccountChannelsSources(
  enabled: (scope: ChannelsSourceScope) => boolean,
  sortBy: (group: ChannelsSortGroup) => ChannelListSort,
  cachedChannels: Accessor<readonly ChannelEntity[]> = () => []
): ChannelsSources {
  return {
    team_channels: useChannelsDataSource(
      'team_channels',
      () => enabled('team_channels'),
      () => sortBy('team_channels'),
      cachedChannels
    ),
    channels: useChannelsDataSource(
      'channels',
      () => enabled('channels'),
      () => sortBy('channels'),
      cachedChannels
    ),
    direct_messages: useChannelsDataSource(
      'direct_messages',
      () => enabled('direct_messages'),
      () => sortBy('direct_messages'),
      cachedChannels
    ),
    recents: useChannelsDataSource(
      'recents',
      () => enabled('recents'),
      () => undefined,
      cachedChannels
    ),
    search: useChannelsDataSource(
      'search',
      () => enabled('search'),
      () => undefined,
      cachedChannels
    ),
    threads: useThreadChannelsDataSource(
      () => enabled('threads'),
      () => sortBy('threads')
    ),
  };
}

/** Retire observers with their login session, without clearing account caches. */
export function useChannelsSources(
  enabled: (scope: ChannelsSourceScope) => boolean,
  sortBy: (group: ChannelsSortGroup) => ChannelListSort,
  cachedChannels: Accessor<readonly ChannelEntity[]> = () => []
): ChannelsSources {
  const account = useQueryAccount();
  const sources = createMemo(
    on(account, (owner) => {
      if (!owner) return;
      return untrack(() =>
        createAccountChannelsSources(enabled, sortBy, cachedChannels)
      );
    })
  );
  const scopedSource = (scope: ChannelsSourceScope): ChannelsDataSource => {
    const current = () => sources()?.[scope];
    return {
      items: () => current()?.items() ?? [],
      isLoading: () => current()?.isLoading() ?? false,
      isFetching: () => current()?.isFetching() ?? false,
      error: () => current()?.error(),
      hasMore: () => current()?.hasMore() ?? false,
      isLoadingMore: () => current()?.isLoadingMore() ?? false,
      loadMore: async () => {
        await current()?.loadMore();
      },
      refresh: async () => {
        await current()?.refresh();
      },
    };
  };
  return {
    team_channels: scopedSource('team_channels'),
    channels: scopedSource('channels'),
    direct_messages: scopedSource('direct_messages'),
    recents: scopedSource('recents'),
    search: scopedSource('search'),
    threads: scopedSource('threads'),
  };
}
