import { useUserId } from '@core/context/user';
import { arrayEquals } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, type EntityData, isChannelEntity } from '@entity';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { registerChannelNotificationRefresh } from '@queries/channel/register-notification-refresh';
import { queryReadyGate } from '@queries/gate';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  mapGraphqlSoupItem,
} from '@service-storage/graphql-soup';
import { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { channelsByIdsQueryArgs, useChannelsByIdsQuery } from '../queries';

const CHANNEL_SELECTION = selectRecords(ChannelListItemFieldsFragmentDoc);
const BATCH_SIZE = 500;
const EMPTY_IDS: ReadonlySet<string> = new Set();
export type ReferencedChannelsLookup = {
  readonly data: { entities: readonly EntityData[] } | undefined;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly isPlaceholderData: boolean;
  readonly hasNextPage: boolean;
};

type ChannelCache = Pick<
  CacheHost,
  | 'readRecordsByKeys'
  | 'currentRevision'
  | 'onCacheChanged'
  | 'onCacheGenerationChanged'
>;

function batches(ids: readonly string[]) {
  const result: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    result.push(ids.slice(offset, offset + BATCH_SIZE));
  }
  return result;
}

/** Missing and fragment-incomplete records are omitted by the cache engine. */
async function readCachedChannels(host: ChannelCache, ids: readonly string[]) {
  const reads = [];
  for (const idsBatch of batches(ids)) {
    reads.push(
      await readRecordsByKeys(
        host,
        CHANNEL_SELECTION,
        idsBatch.map((id) => `GraphqlSoupChannel:${id}`)
      )
    );
  }
  const revision = await host.currentRevision();
  if (reads.some((read) => read.revision !== revision)) return undefined;
  return reads.flatMap((read) =>
    read.records.flatMap(({ record }) => {
      const item = mapGraphqlSoupItem(record);
      if (!item) return [];
      const entity = mapApiSoupItemToEntity(item);
      return isChannelEntity(entity) ? [entity] : [];
    })
  );
}

/** Keep unchanged rows stable when an unrelated cache write triggers a read. */
function mergeChannels(
  previous: ReadonlyMap<string, ChannelEntity>,
  channels: readonly ChannelEntity[],
  replace = false
) {
  const next = replace ? new Map<string, ChannelEntity>() : new Map(previous);
  for (const channel of channels) {
    const old = previous.get(channel.id);
    next.set(
      channel.id,
      old && JSON.stringify(old) === JSON.stringify(channel) ? old : channel
    );
  }
  if (
    next.size === previous.size &&
    [...next].every(([id, value]) => previous.get(id) === value)
  ) {
    return previous;
  }
  return next;
}

/** Owns one membership snapshot's cache reads and stable, paginated lookups. */
export function createReferencedChannels(options: {
  ids: Accessor<readonly string[]>;
  loadedChannels: Accessor<readonly ChannelEntity[]>;
  host?: ChannelCache;
  query: (ids: Accessor<readonly string[]>) => ReferencedChannelsLookup;
}) {
  const host = options.host;
  const ids = createMemo(() => [...new Set(options.ids())].sort(), [], {
    equals: arrayEquals,
  });
  const [cached, setCached] = createSignal<ReadonlyMap<string, ChannelEntity>>(
    new Map()
  );
  const [fetched, setFetched] = createSignal<
    ReadonlyMap<string, ChannelEntity>
  >(new Map());
  const [cacheReady, setCacheReady] = createSignal(!options.host);
  const [attempted, setAttempted] =
    createSignal<ReadonlySet<string>>(EMPTY_IDS);
  const [failedIds, setFailedIds] =
    createSignal<ReadonlySet<string>>(EMPTY_IDS);
  const [error, setError] = createSignal<unknown>();
  const [requestIds, setRequestIds] = createSignal<readonly string[]>([]);
  let active = true;
  let epoch = 0;
  let reading = false;
  let readAgain = false;

  const channels = createMemo(() => {
    const available = new Map(fetched());
    for (const channel of options.loadedChannels())
      available.set(channel.id, channel);
    for (const [id, channel] of cached()) available.set(id, channel);
    return ids().flatMap((id) => available.get(id) ?? []);
  });
  const unresolved = createMemo(() => {
    const loaded = new Set(channels().map((channel) => channel.id));
    return ids().filter((id) => !loaded.has(id));
  });
  const pendingIds = createMemo(
    () => new Set(unresolved().filter((id) => !attempted().has(id)))
  );

  const request = createMemo(
    on(requestIds, (requested) => {
      if (requested.length === 0) return;
      const query = options.query(() => requested);
      const [done, setDone] = createSignal(false);
      const span = Telemetry.span('channels.section.hydrate');
      span.setAttr('channels.requested_count', requested.length);
      if (requested[0]) span.setAttr('channel.id', requested[0]);
      let ended = false;
      const finish = () => {
        if (!ended) span.end();
        ended = true;
      };
      onCleanup(finish);
      return { ids: requested, query, done, setDone, span, finish };
    })
  );

  createEffect(() => {
    const current = request();
    if (!current) return;
    const query = current.query;
    if (query.isPlaceholderData) return;
    if (queryReadyGate(query)) {
      const entities = query.data.entities.filter(isChannelEntity);
      setFetched((previous) => {
        const next = mergeChannels(previous, entities);
        if (query.isFetching || query.error || query.hasNextPage) return next;
        const present = new Set(entities.map((entity) => entity.id));
        return new Map(
          [...next].filter(
            ([id]) => !current.ids.includes(id) || present.has(id)
          )
        );
      });
    }
    if (current.done() || query.isFetching || query.isPending) return;
    if (!query.error && query.hasNextPage) return;
    batch(() => {
      setAttempted((previous) => new Set([...previous, ...current.ids]));
      if (query.error) {
        setFailedIds((previous) => new Set([...previous, ...current.ids]));
        setError(query.error);
        current.span.error('Channel hydration failed');
      } else {
        setFailedIds(
          (previous) =>
            new Set([...previous].filter((id) => !current.ids.includes(id)))
        );
      }
      current.setDone(true);
      current.finish();
    });
  });

  createEffect(() => {
    const current = request();
    if (!cacheReady() || (current && !current.done())) return;
    const missing = unresolved().filter((id) => !attempted().has(id));
    if (missing.length > 0) setRequestIds(missing);
  });

  async function readCache() {
    if (!host || reading) return;
    reading = true;
    try {
      while (readAgain && active) {
        readAgain = false;
        const started = epoch;
        const requested = untrack(ids);
        const result = await ResultAsync.fromPromise(
          Telemetry.span('channels.section.cache_read', async (span) => {
            span.setAttr('channels.requested_count', requested.length);
            if (requested[0]) span.setAttr('channel.id', requested[0]);
            const records = await readCachedChannels(host, requested);
            span.setAttr('channels.cached_count', records?.length ?? 0);
            return records;
          }),
          (failure) => failure
        );
        if (!active || started !== epoch) continue;
        const records = result.isOk() ? result.value : undefined;
        batch(() => {
          if (records) {
            const present = new Set(records.map((record) => record.id));
            const removed = new Set(
              [...untrack(cached).keys()].filter((id) => !present.has(id))
            );
            setCached((previous) => mergeChannels(previous, records, true));
            if (removed.size > 0) {
              // A coherent cache invalidation must not resurrect old network rows.
              setFetched(
                (previous) =>
                  new Map([...previous].filter(([id]) => !removed.has(id)))
              );
              setAttempted(
                (previous) =>
                  new Set([...previous].filter((id) => !removed.has(id)))
              );
              setFailedIds(
                (previous) =>
                  new Set([...previous].filter((id) => !removed.has(id)))
              );
            }
          }
          // Cache errors or concurrent writes fall back to the normal query.
          setCacheReady(true);
        });
      }
    } finally {
      reading = false;
    }
  }

  const scheduleRead = () => {
    readAgain = true;
    fireAndForget(readCache(), 'channels-view');
  };
  createEffect(
    on(ids, (requested) => {
      epoch += 1;
      const keep = new Set(requested);
      batch(() => {
        setCached(
          (previous) => new Map([...previous].filter(([id]) => keep.has(id)))
        );
        setFetched(
          (previous) => new Map([...previous].filter(([id]) => keep.has(id)))
        );
        setAttempted(
          (previous) => new Set([...previous].filter((id) => keep.has(id)))
        );
        setFailedIds(
          (previous) => new Set([...previous].filter((id) => keep.has(id)))
        );
        setCacheReady(!host);
      });
      if (host) scheduleRead();
    })
  );
  if (host) {
    onCleanup(host.onCacheChanged(scheduleRead, { includeHydration: true }));
    onCleanup(
      host.onCacheGenerationChanged(() => {
        epoch += 1;
        batch(() => {
          setCached(new Map());
          setFetched(new Map());
          setAttempted(EMPTY_IDS);
          setFailedIds(EMPTY_IDS);
          setError(undefined);
          setRequestIds([]);
          setCacheReady(false);
        });
        scheduleRead();
      })
    );
  }
  onCleanup(() => {
    active = false;
    epoch += 1;
  });

  return {
    channels,
    pendingIds,
    failedIds,
    error: () =>
      unresolved().some((id) => failedIds().has(id)) ? error() : undefined,
    isLoading: () =>
      !cacheReady() ||
      pendingIds().size > 0 ||
      Boolean(request() && !request()?.done()),
    /** Requeue unresolved records; query errors remain visible until Retry. */
    retry: async () => {
      batch(() => {
        const retryIds = new Set(unresolved());
        setAttempted(
          (previous) => new Set([...previous].filter((id) => !retryIds.has(id)))
        );
        setFailedIds(EMPTY_IDS);
        setError(undefined);
        if (!request() || request()?.done()) setRequestIds([]);
      });
    },
  };
}

/** Cache reads and query owners never survive an account or rollout change. */
export function useReferencedChannels(
  ids: Accessor<readonly string[]>,
  loadedChannels: Accessor<readonly ChannelEntity[]>,
  enabled: Accessor<boolean>
) {
  const userId = useUserId();
  const source = createMemo(() => {
    if (!enabled() || !userId()) return;
    const host = getGraphqlSoupCacheHost();
    return untrack(() => {
      const state = createReferencedChannels({
        ids,
        loadedChannels,
        host,
        query: useChannelsByIdsQuery,
      });
      if (host) {
        // Cache-only rows still need bounded unread-edge refreshes on pushes.
        registerChannelNotificationRefresh(() => ({
          client: getGraphqlSoupClient(),
          queries: batches([...new Set(ids())]).map((batchIds) => ({
            document: ChannelListSoupDocument,
            variables: {
              input: makeGraphqlSoupInput({
                ...channelsByIdsQueryArgs(batchIds),
                cursor: null,
              }),
            },
          })),
          reader: {
            enabled: true,
            fetching: state.isLoading(),
            filtered: true,
            notificationIds: state
              .channels()
              .flatMap(
                (channel) =>
                  channel.unreadNotifications?.map(
                    (notification) => notification.id
                  ) ?? []
              ),
          },
        }));
      }
      return state;
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
