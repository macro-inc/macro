import type { ListDataSource } from '@app/components/list';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type ChannelEntity,
  type EntityData,
  isChannelEntity,
  isChannelThreadEntity,
} from '@entity';
import {
  type SoupAstItemsQueryArgs,
  type SoupAstParams,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createEffect, createMemo } from 'solid-js';
import { sortChannels } from './core/channel-sort';
import { channelThreadsQueryArgs } from './core/channel-threads-query';
import type {
  ChannelListSort,
  ChannelsQueryScope,
  ChannelsSortGroup,
} from './types';
import { channelHasMessages, isDirectMessage, isTeamChannel } from './utils';

/** Threads per page the Threads rail reads to find their channels. */
const THREAD_CHANNELS_PAGE_SIZE = 100;
/**
 * Pages the rail loads on its own. A few busy channels can fill the first
 * page, leaving a list too short to scroll, so it keeps paging up to this cap;
 * scrolling the rail loads the rest.
 */
const THREAD_CHANNELS_AUTO_PAGES = 5;

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
  /**
   * Conversations with an unread top-level message or mention, newest activity
   * first: the same notifications that light a row's dot. The server filters
   * and pages them, so the list never walks every conversation to find them.
   */
  unread: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: { channelMessageSeen: false, channelIsParticipant: [true] },
    }),
    matches: () => true,
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

/**
 * Fetch specific channels by id, for labelled channels the paginated Channels
 * source has not reached yet. Page through the requested IDs independently
 * of the main list so broad smart tags include all their matched channels.
 */
export function channelsByIdsQueryArgs(
  channelIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      ...CHANNELS_QUERY_PARAMS,
      limit: Math.min(500, Math.max(1, channelIds.length)),
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { channelId: [...channelIds] },
        })
      )
    ),
  };
}

export function useChannelsByIdsQuery(channelIds: Accessor<readonly string[]>) {
  const query = useSoupAstItemsQuery(
    () => channelsByIdsQueryArgs(channelIds()),
    // Rail rows need only bounded unread evidence, like the channel lists.
    () => ({
      enabled: channelIds().length > 0,
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  // Drive the external paginated query until all requested matches are loaded.
  createEffect(() => {
    if (
      !query.isEnabled ||
      query.isLoading ||
      query.isFetching ||
      query.error ||
      !query.hasNextPage
    )
      return;
    fireAndForget(query.fetchNextPage(), 'channels-view');
  });
  return query;
}

/**
 * The channels a by-id lookup has resolved.
 *
 * A settled lookup answers for every id it asked about — its data covers the
 * pages fetched so far — so it replaces the previous answer and a channel it
 * stops returning reads as unresolved. A pending or failed lookup keeps the
 * last answer instead, so a failed page does not empty the rows built from it.
 */
export function resolveReferencedChannels(
  previous: ChannelEntity[],
  lookup: {
    isEnabled: boolean;
    isLoading: boolean;
    error: unknown;
    entities: readonly EntityData[] | undefined;
  }
): ChannelEntity[] {
  if (!lookup.isEnabled || lookup.isLoading || lookup.error || !lookup.entities)
    return previous;

  return lookup.entities.filter(isChannelEntity);
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
  const threadsQuery = useSoupAstItemsQuery(
    () => {
      const args = channelThreadsQueryArgs(userId() ?? '', undefined);
      return {
        ...args,
        params: { ...args.params, limit: THREAD_CHANNELS_PAGE_SIZE },
      };
    },
    () => ({ enabled: enabled() && Boolean(userId()), staleTime: 30_000 })
  );
  // Drive the paginated query on its own until the cap, like
  // `useChannelsByIdsQuery`, so later-page conversations appear without scroll.
  createEffect(() => {
    if (
      !threadsQuery.isEnabled ||
      threadsQuery.isLoading ||
      threadsQuery.isFetching ||
      threadsQuery.error ||
      !threadsQuery.hasNextPage ||
      (threadsQuery.data?.entities.length ?? 0) >=
        THREAD_CHANNELS_PAGE_SIZE * THREAD_CHANNELS_AUTO_PAGES
    )
      return;
    fireAndForget(threadsQuery.fetchNextPage(), 'channels-view');
  });
  const channelIds = createMemo<string[]>((previous) => {
    if (!threadsQuery.isEnabled || threadsQuery.isLoading) return previous;
    const ids = new Set<string>();
    for (const entity of threadsQuery.data?.entities ?? []) {
      if (isChannelThreadEntity(entity) && !entity.deletedAt)
        ids.add(entity.channelId);
    }
    return [...ids];
  }, []);
  const channelsQuery = useChannelsByIdsQuery(channelIds);
  const items = createMemo<ChannelEntity[]>((previous) => {
    if (channelIds().length === 0) return [];
    if (!channelsQuery.isEnabled || channelsQuery.isLoading) return previous;
    const byId = new Map(
      (channelsQuery.data?.entities ?? [])
        .filter(isChannelEntity)
        .map((channel) => [channel.id, channel])
    );
    return sortChannels(
      channelIds().flatMap((id) => byId.get(id) ?? []),
      sortMethod()
    );
  }, []);

  return {
    items,
    isLoading: () =>
      items().length === 0 &&
      ((threadsQuery.isEnabled && threadsQuery.isLoading) ||
        (channelsQuery.isEnabled && channelsQuery.isLoading)),
    isFetching: () =>
      (threadsQuery.isEnabled && threadsQuery.isFetching) ||
      (channelsQuery.isEnabled && channelsQuery.isFetching),
    error: () =>
      (threadsQuery.isEnabled ? threadsQuery.error : null) ??
      (channelsQuery.isEnabled ? channelsQuery.error : null) ??
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
  sortMethod: Accessor<ChannelListSort | undefined>
): ChannelsDataSource {
  const query = useSoupAstItemsQuery(
    () => channelsQueryArgs(scope, sortMethod()),
    () => ({
      enabled: enabled(),
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  const items = createMemo<ChannelEntity[]>((previous) => {
    if (!query.isEnabled || query.isPending) return previous;

    const channels = filterChannelsForScope(
      scope,
      (query.data?.entities ?? []).filter(isChannelEntity)
    );

    if (scope === 'recents' || scope === 'unread') return channels;

    return sortChannels(
      channels,
      sortMethod() ?? CHANNELS_QUERY_DEFINITIONS[scope].params.sort_method
    );
  }, []);

  return {
    items,
    isLoading: () => query.isEnabled && query.isLoading && items().length === 0,
    isFetching: () => query.isEnabled && query.isFetching,
    error: () => (query.isEnabled ? (query.error ?? undefined) : undefined),
    hasMore: () => query.isEnabled && query.hasNextPage,
    isLoadingMore: () => query.isEnabled && query.isFetchingNextPage,
    loadMore: async () => {
      if (!query.isEnabled || query.isFetchingNextPage || !query.hasNextPage) {
        return;
      }

      await query.fetchNextPage();
    },
    refresh: async () => {
      if (!query.isEnabled) return;
      await query.refresh();
    },
  };
}

/**
 * The Unread list as shown: the server's unread page kept consistent with the
 * rows' dots, plus the selected conversation.
 *
 * A row whose dot the local read state has already cleared (read here or on
 * another device) leaves at once instead of waiting for the page to refresh.
 * The selected conversation is the exception: opening a row marks it read,
 * which would otherwise pull it out from under the pointer, so it stays in
 * place without a dot until another conversation is selected.
 */
export function createUnreadListSource(
  source: ChannelsDataSource,
  selectedChannelId: Accessor<string | undefined>,
  hasUnread: (channelId: string) => boolean
): ChannelsDataSource {
  const retained = createMemo<
    { channel: ChannelEntity; index: number } | undefined
  >((previous) => {
    const id = selectedChannelId();
    if (id === undefined) return undefined;
    const items = source.items();
    const index = items.findIndex((channel) => channel.id === id);
    if (index >= 0) return { channel: items[index], index };
    return previous?.channel.id === id ? previous : undefined;
  });
  const items = createMemo<ChannelEntity[]>(() => {
    const selected = selectedChannelId();
    const shown = source
      .items()
      .filter((channel) => channel.id === selected || hasUnread(channel.id));
    const kept = retained();
    if (!kept || shown.some((channel) => channel.id === kept.channel.id))
      return shown;
    const read = { ...kept.channel, unreadNotifications: [] };
    const at = Math.min(kept.index, shown.length);
    return [...shown.slice(0, at), read, ...shown.slice(at)];
  });
  return { ...source, items };
}

export function useChannelsSources(
  enabled: (scope: ChannelsSourceScope) => boolean,
  sortBy: (group: ChannelsSortGroup) => ChannelListSort
): ChannelsSources {
  return {
    team_channels: useChannelsDataSource(
      'team_channels',
      () => enabled('team_channels'),
      () => sortBy('team_channels')
    ),
    channels: useChannelsDataSource(
      'channels',
      () => enabled('channels'),
      () => sortBy('channels')
    ),
    direct_messages: useChannelsDataSource(
      'direct_messages',
      () => enabled('direct_messages'),
      () => sortBy('direct_messages')
    ),
    recents: useChannelsDataSource(
      'recents',
      () => enabled('recents'),
      () => undefined
    ),
    unread: useChannelsDataSource(
      'unread',
      () => enabled('unread'),
      () => undefined
    ),
    search: useChannelsDataSource(
      'search',
      () => enabled('search'),
      () => undefined
    ),
    threads: useThreadChannelsDataSource(
      () => enabled('threads'),
      () => sortBy('threads')
    ),
  };
}
