import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { ChannelListSoupDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { makeGraphqlSoupInput } from '../../soup/graphql/ast';
import type { SoupAstItemsQueryArgs } from '../../soup/items';

/** Unread channels kept ready on the device, most recently active first. */
export const PREWARM_UNREAD_CHANNELS = 40;
/** Recently used channels kept ready on the device, besides unread ones. */
export const PREWARM_RECENT_CHANNELS = 20;

const joined = { channelIsParticipant: [true] };

const UNREAD_CHANNELS: SoupAstItemsQueryArgs = {
  params: { limit: PREWARM_UNREAD_CHANNELS, sort_method: 'updated_at' },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters({ include: { ...joined, channelSeen: false } })
    )
  ),
};

const RECENT_CHANNELS: SoupAstItemsQueryArgs = {
  params: { limit: PREWARM_RECENT_CHANNELS, sort_method: 'viewed_at' },
  body: compileToAst(queryStateFrom(defineQueryFilters({ include: joined }))),
};

export type FetchChannelListIds = (
  list: SoupAstItemsQueryArgs
) => Promise<string[]>;

/**
 * One page of a channel list, filtered, ordered and cut off by the server.
 * The cache answers it without a request when it already maintains the list.
 */
const fetchChannelListIds: FetchChannelListIds = async (list) => {
  const result = await getGraphqlSoupClient()
    .query(
      ChannelListSoupDocument,
      { input: makeGraphqlSoupInput(list) },
      { requestPolicy: 'cache-first' }
    )
    .toPromise();
  if (result.error) throw result.error;
  return (result.data?.user.soup.items ?? []).flatMap((item) =>
    item.__typename === 'GraphqlSoupChannel' ? [item.id] : []
  );
};

/**
 * The channels to keep ready, in warming order: up to forty unread ones, most
 * recently active first, then the twenty most recently used.
 */
export async function loadPrewarmChannelIds(
  fetchIds: FetchChannelListIds = fetchChannelListIds
): Promise<string[]> {
  const unread = await fetchIds(UNREAD_CHANNELS);
  const recent = await fetchIds(RECENT_CHANNELS);
  return [...new Set([...unread, ...recent])];
}
