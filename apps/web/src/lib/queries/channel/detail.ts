import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  ChannelDetailSoupDocument,
  type ChannelDetailSoupQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import {
  type Client,
  makeOperation,
  type OperationResult,
  type RequestPolicy,
} from '@urql/core';
import {
  type Accessor,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { createLiveQuery } from '../../graphql-cache/solid/create-live-query';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { mapApiSoupItemToEntity } from '../soup/transform-utils';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

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
  // Only a server result can decide that a channel is inaccessible. Cache
  // projections can temporarily omit a newly joined channel, including after
  // its network response has arrived but before persistence catches up.
  const [server, setServer] = createSignal<{
    id: string | undefined;
    client: Client;
    result: OperationResult<ChannelDetailSoupQuery>;
  }>();
  const membershipCheck = createMemo<{ checked?: boolean }>(
    on([channelId, getGraphqlSoupClient, enabled], () => ({}))
  );
  const currentServer = () => {
    const value = server();
    return value?.id === channelId() && value?.client === getGraphqlSoupClient()
      ? value.result
      : undefined;
  };
  const includesChannel = (data: ChannelDetailSoupQuery | undefined) =>
    data?.user?.soup?.items.some((item) => item.id === channelId()) ?? false;
  const variables = createMemo(() => {
    const id = channelId();
    const input = id && buildGraphqlEntitySoupInput('CHANNEL', id);
    return input ? { input } : undefined;
  });
  const query = createLiveQuery(ChannelDetailSoupDocument, variables, () => {
    const id = channelId();
    const client = getGraphqlSoupClient();
    const membership = membershipCheck();
    return {
      client,
      enabled: enabled(),
      requestPolicy,
      keepPreviousData: false,
      onResult: (result) => {
        const source = normalizedCacheResultMetadata(result)?.source;
        if (!source || source === 'live-network') {
          if (!result.stale && !result.hasNext)
            setServer({ id, client, result });
          return;
        }
        if (result.stale || result.hasNext) return;
        const cachedMembership = includesChannel(result.data);
        const confirmed = currentServer();
        const confirmedMembership =
          !!confirmed && !confirmed.error && includesChannel(confirmed.data);
        if (
          (!confirmed && cachedMembership) ||
          (confirmed && cachedMembership === confirmedMembership)
        ) {
          membership.checked = undefined;
          return;
        }
        // A cache-only membership change is a hint to check the server, in
        // either direction. Confirm it once even if the same stale projection
        // keeps arriving after a successful response.
        if (membership.checked !== cachedMembership) {
          membership.checked = cachedMembership;
          client.reexecuteOperation(
            makeOperation('query', result.operation, {
              ...result.operation.context,
              requestPolicy: 'network-only',
            })
          );
        }
      },
    };
  });
  const data = createMemo(() => {
    if (query.isPending) return undefined;
    const confirmed = currentServer();
    if (confirmed?.error) return undefined;
    // A confirmed absence must also win over later stale positive cache rows.
    let value = confirmed?.data;
    if (
      (!confirmed || includesChannel(confirmed.data)) &&
      includesChannel(query.data)
    ) {
      value = query.data;
    }
    return value
      ? {
          entities: mapGraphqlSoupPage(value).items.map(mapApiSoupItemToEntity),
        }
      : undefined;
  });
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: variables()
      ? [{ document: ChannelDetailSoupDocument, variables: variables()! }]
      : [],
    reader: {
      enabled: query.isEnabled,
      fetching: query.isFetching,
      channelId: channelId(),
      filtered: true,
      notificationIds: query.isSuccess
        ? (
            query.data?.user.soup.items.find((item) => item.id === channelId())
              ?.notifications ?? []
          ).map((notification) => notification.id)
        : [],
    },
  }));
  // Keep unavailable routes subscribed to invite/reconnect revalidation too;
  // their message view (and its notification reader) is not mounted yet.
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => query.isEnabled,
      refresh,
    })
  );
  onCleanup(
    registerGraphqlSoupRevalidations(
      () =>
        query.isEnabled && variables()
          ? [{ document: ChannelDetailSoupDocument, variables: variables()! }]
          : [],
      getGraphqlSoupClient
    )
  );
  return {
    get isEnabled() {
      return query.isEnabled;
    },
    get isPending() {
      return query.isPending || (!currentServer() && !data());
    },
    get isLoading() {
      return query.isLoading;
    },
    get isFetching() {
      return query.isFetching;
    },
    get error() {
      return currentServer()?.error ?? null;
    },
    get data() {
      return data();
    },
    refresh,
  };
}
