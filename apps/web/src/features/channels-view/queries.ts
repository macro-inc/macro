import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { ChannelEntity } from '@entity';
import {
  type SoupAstItemsQueryArgs,
  type SoupAstParams,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import type { ChannelsQueryScope } from './types';

const CHANNELS_QUERY_PARAMS = {
  limit: 100,
  sort_method: 'updated_at',
} satisfies SoupAstParams;

type ChannelsQueryDefinition = {
  params: SoupAstParams;
  filters: ReturnType<typeof defineQueryFilters>;
  matches: (channel: ChannelEntity) => boolean;
};

export const CHANNELS_QUERY_DEFINITIONS = {
  recents: {
    params: CHANNELS_QUERY_PARAMS,
    filters: defineQueryFilters({
      include: {
        channelImportance: true,
        channelIsParticipant: [true],
      },
    }),
    matches: (channel) => Boolean(channel.latestRootMessage),
  },
  channels: {
    params: CHANNELS_QUERY_PARAMS,
    filters: defineQueryFilters({
      include: { channelIsParticipant: [true] },
      exclude: { channelType: ['direct_message'] },
    }),
    matches: (channel) => channel.channelType !== 'direct_message',
  },
  direct_messages: {
    params: CHANNELS_QUERY_PARAMS,
    filters: defineQueryFilters({
      include: {
        channelType: ['direct_message'],
        channelIsParticipant: [true],
      },
    }),
    matches: (channel) => channel.channelType === 'direct_message',
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

export function useChannelsQuery(scope: Accessor<ChannelsQueryScope>) {
  return useSoupAstItemsQuery(
    () => channelsQueryArgs(scope()),
    () => ({ staleTime: 30_000 })
  );
}
