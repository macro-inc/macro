import { useUserId } from '@core/context/user';
import { arrayEquals } from '@core/util/compareUtils';
import { type ChannelEntity, isChannelEntity } from '@entity';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { registerChannelNotificationRefresh } from '@queries/channel/register-notification-refresh';
import { queryReadyGate } from '@queries/gate';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { ChannelListSoupDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo, untrack } from 'solid-js';
import { channelsByIdsQueryArgs, useChannelsByIdsQuery } from '../queries';

const BATCH_SIZE = 500;
const EMPTY_IDS: ReadonlySet<string> = new Set();

function createChannelBatch(
  ids: readonly string[],
  loadedChannels: Accessor<readonly ChannelEntity[]>
) {
  // The ordinary Soup predicate supplies cached rows and owns cache subscriptions.
  const cached = useChannelsByIdsQuery(
    () => ids,
    () => ({ networkPaused: true })
  );
  const cacheReady = () =>
    cached.cacheStatus !== 'idle' && cached.cacheStatus !== 'loading';
  const available = () => [
    ...(queryReadyGate(cached)
      ? cached.data.entities.filter(isChannelEntity)
      : []),
    ...loadedChannels(),
  ];
  let querySettled = () => true;
  const requested = createMemo<readonly string[]>(
    (previous) => {
      if (!cacheReady()) return [];
      if (previous.length > 0 && !querySettled()) return previous;
      const known = new Set(available().map((channel) => channel.id));
      // Cache writes must not change an in-flight query's variables or page chain.
      return [...new Set([...previous, ...ids.filter((id) => !known.has(id))])];
    },
    [],
    { equals: arrayEquals }
  );
  const network = useChannelsByIdsQuery(requested);
  const error = () => network.fetchError ?? network.error;
  querySettled = () =>
    !network.isPending &&
    !network.isFetching &&
    !network.hasNextPage &&
    !error();
  const channels = createMemo(() => {
    const rows = new Map(
      [
        ...(queryReadyGate(network)
          ? network.data.entities.filter(isChannelEntity)
          : []),
        ...available(),
      ].map((channel) => [channel.id, channel])
    );
    return ids.flatMap((id) => rows.get(id) ?? []);
  });
  const unresolved = () => {
    const known = new Set(channels().map((channel) => channel.id));
    return ids.filter((id) => !known.has(id));
  };
  const loading = () =>
    !cacheReady() ||
    (requested().length > 0 &&
      !error() &&
      (network.isPending || network.isFetching || network.hasNextPage));

  return {
    channels,
    loading,
    pendingIds: () => (loading() ? unresolved() : []),
    failedIds: () => (cacheReady() && error() ? unresolved() : []),
    error: () => (unresolved().length > 0 ? error() : undefined),
    retry: () => network.refresh(),
  };
}

/** Label IDs define membership; ordinary Soup queries supply and refresh rows. */
export function useReferencedChannels(
  ids: Accessor<readonly string[]>,
  loadedChannels: Accessor<readonly ChannelEntity[]>,
  enabled: Accessor<boolean>
) {
  const userId = useUserId();
  const memberIds = createMemo(() => [...new Set(ids())].sort(), [], {
    equals: arrayEquals,
  });
  const source = createMemo(() => {
    const members = memberIds();
    if (!enabled() || !userId()) return;
    return untrack(() => {
      const batches: Array<ReturnType<typeof createChannelBatch>> = [];
      const queries: QueryRevalidation[] = [];
      for (let offset = 0; offset < members.length; offset += BATCH_SIZE) {
        const batchIds = members.slice(offset, offset + BATCH_SIZE);
        batches.push(createChannelBatch(batchIds, loadedChannels));
        queries.push({
          document: ChannelListSoupDocument,
          variables: {
            input: makeGraphqlSoupInput({
              ...channelsByIdsQueryArgs(batchIds),
              cursor: null,
            }),
          },
        });
      }
      const channels = () => batches.flatMap((batch) => batch.channels());
      const loading = () => batches.some((batch) => batch.loading());
      // Cache-only members also need bounded unread-edge refreshes on pushes.
      registerChannelNotificationRefresh(() => ({
        client: getGraphqlSoupClient(),
        queries,
        reader: {
          enabled: members.length > 0,
          fetching: loading(),
          filtered: true,
          notificationIds: channels().flatMap(
            (channel) => channel.unreadNotifications?.map(({ id }) => id) ?? []
          ),
        },
      }));
      return {
        channels,
        isLoading: loading,
        pendingIds: () =>
          new Set(batches.flatMap((batch) => batch.pendingIds())),
        failedIds: () => new Set(batches.flatMap((batch) => batch.failedIds())),
        error: () => batches.find((batch) => batch.error())?.error(),
        retry: async () => {
          await Promise.all(
            batches
              .filter((batch) => batch.error())
              .map((batch) => batch.retry())
          );
        },
      };
    });
  });
  return {
    channels: () => source()?.channels() ?? [],
    pendingIds: () => source()?.pendingIds() ?? EMPTY_IDS,
    failedIds: () => source()?.failedIds() ?? EMPTY_IDS,
    error: () => source()?.error(),
    isLoading: () => source()?.isLoading() ?? false,
    retry: async () => {
      await source()?.retry();
    },
  };
}
