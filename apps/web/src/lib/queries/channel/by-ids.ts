import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { arrayEquals } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, isChannelEntity } from '@entity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type Accessor,
  batch,
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { queryReadyGate } from '../gate';
import {
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

const BATCH_SIZE = 500;

export function channelsByIdsQueryArgs(
  channelIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      limit: Math.min(BATCH_SIZE, Math.max(1, channelIds.length)),
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({ include: { channelId: [...channelIds] } })
      )
    ),
  };
}

/**
 * Keep each channel list's bounded unread and mention projections current,
 * including cached rows. A list given `channelTypes` also waits for a new
 * channel of those types to reach its first page.
 */
export function registerChannelListNotificationRefresh(
  query: SoupAstItemsQuery,
  channelTypes?: readonly string[],
  channelIds?: Accessor<ReadonlySet<string>>
) {
  return registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: query.revalidationQueries ?? [],
    reader: {
      enabled: query.transport === 'graphql' && query.isEnabled,
      fetching: query.isFetching,
      channelTypes,
      channelIds: channelIds?.(),
      filtered: true,
      notificationIds: query.isPending
        ? []
        : (query.data?.entities ?? [])
            .filter(isChannelEntity)
            .flatMap((channel) =>
              [
                ...(channel.unreadNotifications ?? []),
                ...(channel.unreadMentions ?? []),
              ].map(({ id }) => id)
            ),
    },
  }));
}

/** One Soup owner supplies local rows, missing-record fetches, and unread updates. */
export function useChannelsByIdsQuery(
  channelIds: Accessor<readonly string[]>,
  options: Accessor<{ cacheFirst?: boolean }> = () => ({})
) {
  // Soup reads its arguments from multiple reactive computations. Compile the
  // ID filter and membership set once per membership change.
  const membership = createMemo(() => {
    const ids = channelIds();
    return {
      ids,
      idSet: new Set(ids),
      args: channelsByIdsQueryArgs(ids),
    };
  });
  const query = useSoupAstItemsQuery(
    () => membership().args,
    () => {
      const ids = membership().ids;
      return {
        enabled: ids.length > 0,
        staleTime: 30_000,
        graphqlProjection: 'channel-list',
        graphqlCacheFirstEntities: options().cacheFirst
          ? ids.map((entityId) => ({ entityType: 'CHANNEL', entityId }))
          : undefined,
      };
    }
  );
  registerChannelListNotificationRefresh(
    query,
    undefined,
    () => membership().idSet
  );
  createEffect(() => {
    if (
      !query.isEnabled ||
      query.isPending ||
      query.isFetching ||
      query.fetchError ||
      query.error ||
      !query.hasNextPage
    )
      return;
    fireAndForget(query.fetchNextPage(), 'channels-by-id');
  });
  return query;
}

type ChannelBatch = {
  ids: Accessor<readonly string[]>;
  setIds: (next: readonly string[]) => void;
  query: SoupAstItemsQuery;
  channels: Accessor<ChannelEntity[]>;
  unresolved: Accessor<string[]>;
  error: Accessor<Error | null | undefined>;
  loading: Accessor<boolean>;
  dispose: () => void;
};

/** Resolve an authoritative ID set without loading unrelated list pages. */
export function useCachedChannelsByIds(
  ids: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  const owner = getOwner();
  const account = useQueryAccount();
  const memberIds = createMemo(() => [...new Set(ids())].sort(), [], {
    equals: arrayEquals,
  });
  const [source, setSource] = createSignal<readonly ChannelBatch[]>([]);
  let currentAccount: ReturnType<typeof account>;
  let currentEnabled = false;
  let activeBatches: ChannelBatch[] = [];

  const disposeAll = () => {
    for (const entry of activeBatches) entry.dispose();
    activeBatches = [];
  };

  const createBatch = (initialIds: readonly string[]): ChannelBatch =>
    createRoot((dispose) => {
      const [batchIds, setBatchIds] =
        createSignal<readonly string[]>(initialIds);
      const batchIdSet = createMemo(() => new Set(batchIds()));
      const query = useChannelsByIdsQuery(batchIds, () => ({
        cacheFirst: true,
      }));
      // A refresh must not empty sections that already resolved their members.
      // Filter to current bucket membership so removed IDs drop immediately.
      const channels = createMemo<ChannelEntity[]>((previous) => {
        const activeIds = batchIdSet();
        if (!queryReadyGate(query)) {
          return previous.filter((channel) => activeIds.has(channel.id));
        }
        return query.data.entities.filter(
          (entity): entity is ChannelEntity =>
            isChannelEntity(entity) && activeIds.has(entity.id)
        );
      }, []);
      const unresolved = createMemo(() => {
        const loaded = new Set(channels().map((channel) => channel.id));
        return batchIds().filter((id) => !loaded.has(id));
      });
      const error = () => query.fetchError ?? query.error;
      const loading = () =>
        !error() &&
        (query.isPending ||
          query.isFetching ||
          query.hasNextPage ||
          query.cacheStatus === 'loading');
      return {
        ids: batchIds,
        setIds: setBatchIds,
        query,
        channels,
        unresolved,
        error,
        loading,
        dispose,
      };
    }, owner);

  createComputed(() => {
    const nextEnabled = enabled();
    const nextAccount = account();
    const members = memberIds();

    untrack(() => {
      if (!nextEnabled || !nextAccount) {
        if (activeBatches.length > 0) {
          disposeAll();
          setSource([]);
        }
        currentEnabled = nextEnabled;
        currentAccount = nextAccount;
        return;
      }

      // Reset the complete query graph across account or enablement resets.
      if (!currentEnabled || currentAccount !== nextAccount) {
        disposeAll();
      }
      currentEnabled = nextEnabled;
      currentAccount = nextAccount;

      const wanted = new Set(members);
      const assigned = new Set<string>();
      const kept: Array<{
        entry: ChannelBatch;
        nextIds: string[];
        dirty: boolean;
      }> = [];
      let listChanged = false;

      // Keep untouched 500-ID batches intact when individual IDs churn.
      for (const entry of activeBatches) {
        const prevIds = entry.ids();
        const nextIds = prevIds.filter((id) => wanted.has(id));
        if (nextIds.length === 0) {
          entry.dispose();
          listChanged = true;
          continue;
        }
        for (const id of nextIds) assigned.add(id);
        kept.push({
          entry,
          nextIds,
          dirty: nextIds.length !== prevIds.length,
        });
      }

      const added = members.filter((id) => !assigned.has(id));
      let offset = 0;
      // Pack additions into existing buckets with spare capacity (tail first,
      // then earlier partial buckets) so repeated churn cannot strand free
      // slots and multiply active query roots.
      for (
        let index = kept.length - 1;
        index >= 0 && offset < added.length;
        index -= 1
      ) {
        const bucket = kept[index];
        const spare = BATCH_SIZE - bucket.nextIds.length;
        if (spare <= 0) continue;
        const take = added.slice(offset, offset + spare);
        bucket.nextIds = [...bucket.nextIds, ...take].sort();
        bucket.dirty = true;
        offset += take.length;
      }

      // If removals alone fragmented many sparse buckets, merge the smallest
      // ones until bucket count stays bounded to ceil(members / BATCH_SIZE) + 1.
      const maxBuckets =
        Math.max(1, Math.ceil(members.length / BATCH_SIZE)) + 1;
      if (kept.length > maxBuckets) {
        const bySize = kept
          .map((bucket, index) => ({ bucket, index }))
          .sort((a, b) => a.bucket.nextIds.length - b.bucket.nextIds.length);
        const retired = new Set<number>();
        for (const small of bySize) {
          if (kept.length - retired.size <= maxBuckets) break;
          if (retired.has(small.index)) continue;
          const target = bySize.find(
            (candidate) =>
              candidate.index !== small.index &&
              !retired.has(candidate.index) &&
              candidate.bucket.nextIds.length + small.bucket.nextIds.length <=
                BATCH_SIZE
          );
          if (!target) continue;
          target.bucket.nextIds = [
            ...target.bucket.nextIds,
            ...small.bucket.nextIds,
          ].sort();
          target.bucket.dirty = true;
          small.bucket.entry.dispose();
          retired.add(small.index);
          listChanged = true;
        }
        if (retired.size > 0) {
          for (let index = kept.length - 1; index >= 0; index -= 1) {
            if (retired.has(index)) kept.splice(index, 1);
          }
        }
      }

      batch(() => {
        const nextBatches: ChannelBatch[] = [];
        for (const item of kept) {
          if (item.dirty) item.entry.setIds(item.nextIds);
          nextBatches.push(item.entry);
        }
        while (offset < added.length) {
          const chunk = added.slice(offset, offset + BATCH_SIZE);
          nextBatches.push(createBatch(chunk));
          offset += chunk.length;
          listChanged = true;
        }
        if (listChanged || activeBatches.length !== nextBatches.length) {
          activeBatches = nextBatches;
          setSource(nextBatches);
        }
      });
    });
  });

  onCleanup(disposeAll);

  return {
    channels: () => source().flatMap((entry) => entry.channels()),
    pendingIds: () =>
      new Set(
        source().flatMap((entry) => (entry.loading() ? entry.unresolved() : []))
      ),
    failedIds: () =>
      new Set(
        source().flatMap((entry) => (entry.error() ? entry.unresolved() : []))
      ),
    // Successful omissions are unavailable, not placeholders for another page.
    unavailableIds: () =>
      new Set(
        source().flatMap((entry) =>
          entry.query.hasPageData && !entry.loading() && !entry.error()
            ? entry.unresolved()
            : []
        )
      ),
    isLoading: () =>
      source().some(
        (entry) => entry.loading() && entry.unresolved().length > 0
      ),
    error: () =>
      source()
        .find((entry) => entry.error() && entry.unresolved().length)
        ?.error(),
    retry: async () => {
      await Promise.all(
        source()
          .filter((entry) => entry.error() && entry.unresolved().length)
          .map((entry) => entry.query.refresh())
      );
    },
  };
}
