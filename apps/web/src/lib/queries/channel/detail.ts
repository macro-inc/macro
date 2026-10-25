import { ChannelDetailSoupDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import type { RequestPolicy } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createLiveQuery } from '../../graphql-cache/solid/create-live-query';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { mapApiSoupItemToEntity } from '../soup/transform-utils';

/**
 * A conversation and its complete unread edge. Activation readers revalidate
 * on every open; display-only readers can reuse the cache. Its variables match
 * the open channel's unread navigation, so both share one request.
 */
export function createChannelDetailQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>,
  requestPolicy: RequestPolicy = 'cache-and-network'
) {
  const query = createLiveQuery(
    ChannelDetailSoupDocument,
    () => {
      const id = channelId();
      const input = id && buildGraphqlEntitySoupInput('CHANNEL', id);
      return input ? { input } : undefined;
    },
    () => ({
      client: getGraphqlSoupClient(),
      enabled: enabled(),
      requestPolicy,
      select: (data) => ({
        entities: mapGraphqlSoupPage(data).items.map(mapApiSoupItemToEntity),
      }),
    })
  );
  return {
    get isEnabled() {
      return query.isEnabled;
    },
    get isPending() {
      return query.isPending;
    },
    get isLoading() {
      return query.isLoading;
    },
    get isFetching() {
      return query.isFetching;
    },
    get error() {
      return query.error;
    },
    get data() {
      return query.data;
    },
    refresh: async () => {
      await query.refetch({ requestPolicy: 'network-only' });
    },
  };
}
