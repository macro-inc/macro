import type { ListDataSource } from '@app/components/list';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useUserId } from '@core/context/user';
import { compareDateDesc } from '@core/util/date';
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
import {
  channelThreadsQueryArgs,
  isUnansweredOwnMessage,
} from './queries/channel-threads';
import type {
  ChannelListSort,
  ChannelsQueryScope,
  ChannelsSortGroup,
} from './types';
import { channelHasMessages, isDirectMessage } from './utils';

/** Threads per page the Threads rail reads to find their channels. */
const THREAD_CHANNELS_PAGE_SIZE = 100;

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
  channels: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'created_at' },
    filters: defineQueryFilters({
      include: { channelIsParticipant: [true] },
      exclude: { channelType: ['direct_message'] },
    }),
    matches: (channel) => !isDirectMessage(channel),
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

export function channelByIdQueryArgs(channelId: string): SoupAstItemsQueryArgs {
  return {
    params: {
      ...CHANNELS_QUERY_PARAMS,
      limit: 1,
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { channelId: [channelId] },
        })
      )
    ),
  };
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
    () => ({ enabled: channelIds().length > 0, staleTime: 30_000 })
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
    void query.fetchNextPage();
  });
  return query;
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

function sortChannels(
  channels: readonly ChannelEntity[],
  sort: ChannelListSort
): ChannelEntity[] {
  const sortDate = (channel: ChannelEntity) =>
    sort === 'created_at'
      ? channel.createdAt
      : sort === 'viewed_at'
        ? channel.viewedAt
        : channel.updatedAt;

  return channels
    .slice()
    .sort((left, right) => compareDateDesc(sortDate(left), sortDate(right)));
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
  const channelIds = createMemo<string[]>((previous) => {
    if (!threadsQuery.isEnabled || threadsQuery.isLoading) return previous;
    const ids = new Set<string>();
    for (const entity of threadsQuery.data?.entities ?? []) {
      if (
        isChannelThreadEntity(entity) &&
        !entity.deletedAt &&
        !isUnansweredOwnMessage(entity, userId())
      )
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
    if (!query.isEnabled || query.isLoading) return previous;

    const channels = filterChannelsForScope(
      scope,
      (query.data?.entities ?? []).filter(isChannelEntity)
    );

    if (scope === 'recents') return channels;

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

export function useChannelsSources(
  enabled: (scope: ChannelsSourceScope) => boolean,
  sortBy: (group: ChannelsSortGroup) => ChannelListSort
): ChannelsSources {
  return {
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

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useSoupAstItemsQuery(
    () => channelByIdQueryArgs(channelId() ?? ''),
    // Every activation needs a fresh complete edge for thread scoping and marking
    // read. GraphQL revalidates on activation; keep the REST fallback stale too.
    () => ({ enabled: enabled(), staleTime: 0 })
  );
}
