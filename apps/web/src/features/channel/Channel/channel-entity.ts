import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import type { ChannelEntity } from '@entity';
import { createChannelDetailQuery } from '@queries/channel/detail';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

function channelByIdQueryArgs(channelId: string): SoupAstItemsQueryArgs {
  return {
    params: { limit: 1, sort_method: 'created_at' },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { channelId: [channelId] },
        })
      )
    ),
  };
}

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>,
  options: { revalidateOnMount?: boolean } = {}
) {
  // Every activation needs a fresh complete unread edge for marking read.
  // Menu observers reuse that result; activation observers still revalidate.
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const graphql = createChannelDetailQuery(
    channelId,
    () => enabled() && graphqlSoup().enabled,
    options.revalidateOnMount === false ? 'cache-first' : 'cache-and-network'
  );
  const rest = useSoupAstItemsQuery(
    () => ({ ...channelByIdQueryArgs(channelId() ?? ''), transport: 'rest' }),
    () => ({
      enabled: enabled() && !graphqlSoup().enabled,
      staleTime: options.revalidateOnMount === false ? Infinity : 0,
    })
  );
  const query = () => (graphqlSoup().enabled ? graphql : rest);
  return {
    get isEnabled() {
      return query().isEnabled;
    },
    get isPending() {
      return query().isPending;
    },
    get isLoading() {
      return query().isLoading;
    },
    get isFetching() {
      return query().isFetching;
    },
    get error() {
      return query().error;
    },
    get data() {
      return query().data;
    },
    refresh: () => query().refresh(),
  };
}

/**
 * The open conversation as a soup entity, for surfaces that hold a channel id
 * and need the row behind it (its entity actions, say). Shares the by-id
 * query with any other reader of the same channel, so a host that already
 * resolves the conversation does not pay for a second request.
 */
export function useChannelEntity(
  channelId: Accessor<string | undefined>
): Accessor<ChannelEntity | undefined> {
  const query = useChannelByIdQuery(channelId, () => !!channelId(), {
    revalidateOnMount: false,
  });

  return createMemo<ChannelEntity | undefined>((previous) => {
    const id = channelId();
    if (!id) return undefined;
    // A pending read suspends, and a revalidation must not blank what it feeds.
    if (!queryReadyGate(query))
      return previous?.id === id ? previous : undefined;
    const entity = query.data.entities.find((entity) => entity.id === id);
    return entity?.type === 'channel' ? entity : undefined;
  });
}
