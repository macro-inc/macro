import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { isChannelEntity } from '@entity';
import { registerChannelListNotificationRefresh } from '@queries/channel/by-ids';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { channelTypesShownBy } from '../../../core/channel-types';
import {
  soupListLoad,
  traceChannelListLoad,
} from '../../../queries/channel-list-load-trace';

const UNREAD_CHANNEL_FILTERS = defineQueryFilters({
  include: { channelSeen: false, channelIsParticipant: [true] },
});

/**
 * Unread channels the collapsed sections show: one Soup page at its largest
 * size, most recently active first. Unread channels beyond it stay hidden
 * until their section opens.
 */
export const COLLAPSED_UNREAD_CHANNELS_LIMIT = 500;

const UNREAD_CHANNELS_QUERY_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: COLLAPSED_UNREAD_CHANNELS_LIMIT, sort_method: 'updated_at' },
  body: compileToAst(queryStateFrom(UNREAD_CHANNEL_FILTERS)),
};

/**
 * Read unread membership directly instead of exhausting every collapsed
 * channel list: one bounded request, which never loads a continuation page.
 */
export function useCollapsedUnreadChannels(enabled: Accessor<boolean>) {
  const query = useSoupAstItemsQuery(
    () => UNREAD_CHANNELS_QUERY_ARGS,
    () => ({
      enabled: enabled(),
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  registerChannelListNotificationRefresh(
    query,
    channelTypesShownBy(UNREAD_CHANNEL_FILTERS)
  );
  traceChannelListLoad('collapsed_unread', () => soupListLoad(query));
  return () =>
    queryReadyGate(query) ? query.data.entities.filter(isChannelEntity) : [];
}
