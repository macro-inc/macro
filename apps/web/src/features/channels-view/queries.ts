import type { ListDataSource } from '@app/components/list';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { compareDateDesc } from '@core/util/date';
import { type ChannelEntity, type EntityData, isChannelEntity } from '@entity';
import {
  type SoupAstItemsQueryArgs,
  type SoupAstParams,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelsQueryScope } from './types';
import { channelHasMessages, isDirectMessage } from './utils';

const CHANNELS_QUERY_PARAMS = {
  limit: 100,
} satisfies SoupAstParams;

type ChannelsQueryDefinition = {
  params: SoupAstParams;
  filters: ReturnType<typeof defineQueryFilters>;
  matches: (channel: ChannelEntity) => boolean;
};

export type ChannelsDataSource = ListDataSource<ChannelEntity>;

export type ChannelsSources = Record<ChannelsQueryScope, ChannelsDataSource>;

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
} satisfies Record<ChannelsQueryScope, ChannelsQueryDefinition>;

export function channelsQueryArgs(
  scope: ChannelsQueryScope
): SoupAstItemsQueryArgs {
  const definition = CHANNELS_QUERY_DEFINITIONS[scope];

  return {
    params: definition.params,
    body: compileToAst(queryStateFrom(definition.filters)),
  };
}

export function filterChannelsForScope(
  scope: ChannelsQueryScope,
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

function useChannelsDataSource(
  scope: ChannelsQueryScope,
  enabled: Accessor<boolean>
): ChannelsDataSource {
  const query = useSoupAstItemsQuery(
    () => channelsQueryArgs(scope),
    () => ({ enabled: enabled(), staleTime: 30_000 })
  );
  const items = createMemo<ChannelEntity[]>((previous) => {
    if (!query.isEnabled || query.isLoading) return previous;

    const channels = filterChannelsForScope(
      scope,
      (query.data?.entities ?? []).filter(isChannelEntity)
    );

    if (scope !== 'direct_messages') return channels;

    return channels
      .slice()
      .sort((left, right) => compareDateDesc(left.updatedAt, right.updatedAt));
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
  enabled: (scope: ChannelsQueryScope) => boolean
): ChannelsSources {
  return {
    channels: useChannelsDataSource('channels', () => enabled('channels')),
    direct_messages: useChannelsDataSource('direct_messages', () =>
      enabled('direct_messages')
    ),
    recents: useChannelsDataSource('recents', () => enabled('recents')),
  };
}

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useSoupAstItemsQuery(
    () => channelByIdQueryArgs(channelId() ?? ''),
    () => ({ enabled: enabled(), staleTime: 30_000 })
  );
}
