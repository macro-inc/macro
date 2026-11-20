/**
 * The viewer's channel directory: every channel they joined, read from the
 * GraphQL cache that the channel backfill lane fills, or paged from the network
 * into memory when there is no cache to read.
 *
 * A cold cache fills in about a minute on a large account, so the directory
 * says whether it is complete, and a lookup of one channel is `pending` until
 * it can answer. A pending channel is read from the server by id, batched, so
 * the channel on screen loads before the rest.
 */

import { ENABLE_GRAPHQL_BACKFILL } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import {
  ChannelDirectoryPageDocument,
  SoupChannelDirectoryBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  hydrateGraphqlSoup,
} from '@service-storage/graphql-soup';
import { AsyncBatcher } from '@tanstack/pacer';
import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import { useQueryAccount } from '../auth/use-query-account';
import { queryClient } from '../client';
import { readContactCacheScope } from '../contacts/cache-scope';
import { queryReadyGate } from '../gate';
import {
  soupBackfillLaneCompleted,
  watchSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import { ACCOUNT_WIDE_REFRESH_INTERVAL_MS } from '../visible-refresh';
import {
  CHANNEL_SEARCH_BUCKETS,
  createChannelDirectoryIndex,
} from './directory-cache';
import { type DirectoryChannel, toDirectoryChannel } from './directory-core';
import {
  CHANNEL_DIRECTORY_CHECKPOINT_ID,
  CHANNEL_DIRECTORY_INPUT,
} from './directory-lane';
import { readableChannelsInput } from './directory-reconcile';
import { channelKeys } from './keys';

// The server answers a by-id read of at most this many channels in one page.
const BY_ID_BATCH = 100;
const BY_ID_WAIT_MS = 25;
// A failed by-id read is tried once more before its channels stay pending.
const BY_ID_ATTEMPTS = 2;
// Records still lacking a field once the lane finished, read per refresh.
const INCOMPLETE_READS_PER_REFRESH = 500;
const DIRECTORY_STALE_MS = 5 * 60_000;
const CHANNEL_SEARCH_BUCKET_LIST: readonly string[] = CHANNEL_SEARCH_BUCKETS;

/** One channel as the directory can answer for it now. */
export type ChannelLookup =
  | { status: 'loaded'; channel: DirectoryChannel }
  | { status: 'pending' }
  | { status: 'missing' };

/** The directory as one read found it. */
export type ChannelDirectoryState = {
  /** Records with every directory field, joined or not, by id. */
  records: Readonly<Record<string, DirectoryChannel>>;
  /** The channels the viewer joined. */
  joined: readonly DirectoryChannel[];
  /** Cached channel records that lack a directory field, by id. */
  incomplete: Readonly<Record<string, true>>;
  /** Whether `joined` holds every channel the viewer joined. */
  complete: boolean;
};

/** How a channel's by-id read ended: the server returned it, did not, or
 * the read failed twice. */
export type ByIdOutcome = 'returned' | 'absent' | 'failed';

/** What the app reads: the joined channels and lookups of one channel. */
export type ChannelDirectory = {
  /** The channels the viewer joined; partial until `complete`. */
  channels: Accessor<readonly DirectoryChannel[]>;
  complete: Accessor<boolean>;
  /** A joined channel, `pending` while the directory cannot tell yet. A
   * pending lookup reads the channel by id. */
  lookup: (channelId: string) => ChannelLookup;
  /** Every joined channel, read from the network when the directory is not
   * complete yet. */
  readComplete: () => Promise<readonly DirectoryChannel[]>;
  /** Whether filling the directory failed and stays failed until `retry`.
   * The cached directory never does: its backfill lane retries itself. */
  failed: Accessor<boolean>;
  retry: () => void;
};

export const EMPTY_CHANNEL_DIRECTORY_STATE: ChannelDirectoryState = {
  records: {},
  joined: [],
  incomplete: {},
  complete: false,
};

const PENDING: ChannelLookup = { status: 'pending' };
const MISSING: ChannelLookup = { status: 'missing' };

/** The answer for one channel. A complete directory holds every joined
 * channel, so a channel it lacks is not joined; a cached record that lacks
 * a field waits for its by-id read. An unjoined channel is missing, as it
 * was from the REST channel list. */
export function lookupChannel(
  state: ChannelDirectoryState,
  outcomes: Readonly<Record<string, ByIdOutcome>>,
  channelId: string
): ChannelLookup {
  const channel = state.records[channelId];
  if (channel)
    return channel.isParticipant ? { status: 'loaded', channel } : MISSING;
  const outcome = outcomes[channelId];
  if (outcome === 'absent') return MISSING;
  if (!state.complete) return PENDING;
  if (state.incomplete[channelId] && outcome !== 'returned') return PENDING;
  return MISSING;
}

export function sameChannelLookup(a: ChannelLookup, b: ChannelLookup) {
  if (a.status === 'loaded' && b.status === 'loaded')
    return a.channel === b.channel;
  return a.status === b.status;
}

export function channelDirectoryState(
  channels: readonly DirectoryChannel[],
  incompleteIds: readonly string[],
  complete: boolean
): ChannelDirectoryState {
  const records: Record<string, DirectoryChannel> = {};
  const joined: DirectoryChannel[] = [];
  for (const channel of channels) {
    records[channel.id] = channel;
    if (channel.isParticipant) joined.push(channel);
  }
  const incomplete: Record<string, true> = {};
  for (const id of incompleteIds) incomplete[id] = true;
  return { records, joined, incomplete, complete };
}

function sameState(a: ChannelDirectoryState, b: ChannelDirectoryState) {
  if (a.complete !== b.complete) return false;
  const aIds = Object.keys(a.records);
  if (aIds.length !== Object.keys(b.records).length) return false;
  if (aIds.some((id) => a.records[id] !== b.records[id])) return false;
  const aIncomplete = Object.keys(a.incomplete);
  return (
    aIncomplete.length === Object.keys(b.incomplete).length &&
    aIncomplete.every((id) => b.incomplete[id])
  );
}

type UrqlQuery = Pick<Client, 'query'>;

type DirectoryPage = {
  channels: DirectoryChannel[];
  nextCursor: string | null;
};

/** One network page of the directory's query, without the cache. */
async function fetchDirectoryPage(
  client: UrqlQuery,
  input: GraphqlSoupInput,
  signal: AbortSignal | undefined
): Promise<DirectoryPage> {
  const result = await client
    .query(
      ChannelDirectoryPageDocument,
      { input },
      {
        requestPolicy: 'network-only',
        ...(signal ? { fetchOptions: { signal } } : {}),
      }
    )
    .toPromise();
  if (result.error) throw result.error;
  const soup = result.data?.user.soup;
  if (!soup) throw new Error('Channel directory page returned no data');
  return {
    channels: soup.items.flatMap((item) =>
      item.__typename === 'GraphqlSoupChannel' ? [toDirectoryChannel(item)] : []
    ),
    nextCursor: soup.nextCursor,
  };
}

/** Pages every joined channel from the network, the lane's input to its
 * last page. */
export async function fetchJoinedChannels(
  client: UrqlQuery,
  signal?: AbortSignal
): Promise<DirectoryChannel[]> {
  return Telemetry.span('channel_directory.page_all', async (span) => {
    const channels = new Map<string, DirectoryChannel>();
    let input: GraphqlSoupInput = { initial: CHANNEL_DIRECTORY_INPUT };
    let pages = 0;
    for (;;) {
      signal?.throwIfAborted();
      const page = await fetchDirectoryPage(client, input, signal);
      pages += 1;
      // A channel that moved up while the pages were read is kept once.
      for (const channel of page.channels) channels.set(channel.id, channel);
      if (!page.nextCursor) break;
      input = {
        continuation: {
          cursor: page.nextCursor,
          expand: CHANNEL_DIRECTORY_INPUT.expand,
          emailView: CHANNEL_DIRECTORY_INPUT.emailView,
        },
      };
    }
    span.setAttr('channel_directory.pages', pages);
    span.setAttr('channel_directory.channels', channels.size);
    return [...channels.values()];
  });
}

/** Reads channels by id from the network: joined ones, and public or team
 * channels the viewer has not joined. */
async function fetchChannelsById(
  client: UrqlQuery,
  ids: readonly string[],
  signal: AbortSignal
): Promise<DirectoryChannel[]> {
  const page = await fetchDirectoryPage(
    client,
    readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
    signal
  );
  return page.channels;
}

/** Every joined channel, paged from the network into memory. For the
 * directory without a cache, and for a full read before the cache is
 * complete. */
export function channelDirectoryPagesQueryOptions(
  userId: string,
  client: () => UrqlQuery
) {
  return queryOptions({
    queryKey: channelKeys.directory(userId).queryKey,
    queryFn: ({ signal }) => fetchJoinedChannels(client(), signal),
    staleTime: DIRECTORY_STALE_MS,
  });
}

/** Re-reads the in-memory directory after a channel change. The cached
 * directory needs nothing: the server's soup updates keep it current. */
export function refreshChannelDirectory(client: QueryClient = queryClient) {
  return client.invalidateQueries({ queryKey: channelKeys.directory._def });
}

/**
 * Coalesces by-id reads. `read` resolves to the ids the server returned, or
 * undefined when its answer proves nothing about the others. Each id is read
 * at most once until `reset`.
 */
function createByIdReader(
  read: (
    ids: string[],
    signal: AbortSignal
  ) => Promise<ReadonlySet<string> | undefined>
) {
  const [outcomes, setOutcomes] = createSignal<
    Readonly<Record<string, ByIdOutcome>>
  >({});
  let requested = new Set<string>();
  let attempts = new Map<string, number>();
  let controller = new AbortController();
  onCleanup(() => controller.abort());

  const settle = (updates: Record<string, ByIdOutcome>) =>
    setOutcomes((previous) => ({ ...previous, ...updates }));

  const retryOrFail = (ids: readonly string[]) => {
    const failed: Record<string, ByIdOutcome> = {};
    for (const id of ids) {
      const tried = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, tried);
      if (tried < BY_ID_ATTEMPTS) queue(id);
      else failed[id] = 'failed';
    }
    settle(failed);
  };

  // A batch never rejects: a read that a reset aborted settles nothing, and
  // a failed one is retried or marked failed here.
  const readBatch = async (ids: string[]) => {
    const signal = controller.signal;
    try {
      const returned = await Telemetry.span(
        'channel_directory.by_id',
        async (span) => {
          span.setAttr('channel_directory.requested', ids.length);
          const result = await read(ids, signal);
          span.setAttr('channel_directory.returned', result?.size ?? -1);
          return result;
        }
      );
      if (signal.aborted) return;
      const updates: Record<string, ByIdOutcome> = {};
      for (const id of ids)
        updates[id] = !returned || returned.has(id) ? 'returned' : 'absent';
      settle(updates);
    } catch (error) {
      if (signal.aborted) return;
      Telemetry.error(error, { surface: 'channel-directory-by-id' });
      retryOrFail(ids);
    }
  };

  const batcher = new AsyncBatcher<string>(readBatch, {
    wait: BY_ID_WAIT_MS,
    maxSize: BY_ID_BATCH,
  });
  // The batch never rejects; see readBatch.
  const queue = (id: string) =>
    fireAndForget(batcher.addItem(id), 'channel-directory-by-id');

  return {
    outcomes,
    /** Queues a by-id read. Never writes a signal, so a reactive read may
     * call it. */
    request(id: string) {
      if (requested.has(id)) return;
      requested.add(id);
      queue(id);
    },
    /** Forgets every read, for a new storage generation. */
    reset() {
      controller.abort();
      controller = new AbortController();
      requested = new Set();
      attempts = new Map();
      batcher.clear();
      setOutcomes({});
    },
  };
}

/** Runs `run` one at a time; a request during a run runs it again after.
 * The promise settles once a run that started after the request ends. */
function createSerialRunner(run: () => Promise<void>) {
  let running: Promise<void> | undefined;
  let again = false;
  const loop = async () => {
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = undefined;
    }
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}

type CachedDirectoryDeps = {
  host: Pick<
    CacheHost,
    | 'search'
    | 'readRecordsByKeys'
    | 'currentStorageGeneration'
    | 'readQuery'
    | 'onCacheChanged'
  >;
  userId: string;
  hydrate: (
    input: GraphqlSoupInput,
    options: Pick<FetchGraphqlSoupOptions, 'signal'>
  ) => Promise<GraphqlSoupHydrationPage>;
  fetchAll: () => Promise<readonly DirectoryChannel[]>;
};

/** The directory read from the cache. Complete once a pass of the channel
 * lane finished in the cache's current storage generation. */
export function createCachedChannelDirectory(
  deps: CachedDirectoryDeps
): ChannelDirectory {
  const { host, userId } = deps;
  const index = createChannelDirectoryIndex(host);
  const [state, setState] = createSignal(EMPTY_CHANNEL_DIRECTORY_STATE);
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  let generation: string | undefined;

  const reader = createByIdReader(async (ids, signal) => {
    const page = await deps.hydrate(
      readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
      { signal }
    );
    // A lookup answers from the index, so let it see the records first.
    await refresh();
    return page.nextCursor === null && page.entityIds
      ? new Set(page.entityIds)
      : undefined;
  });

  const readIndex = () =>
    Telemetry.span('channel_directory.refresh', async (span) => {
      const signal = controller.signal;
      const scope = await readContactCacheScope(host, userId, signal);
      if (scope === undefined) {
        // Another viewer's cache: nothing in it is this viewer's.
        span.setAttr('channel_directory.scope', 'other_viewer');
        setState(EMPTY_CHANNEL_DIRECTORY_STATE);
        return;
      }
      if (scope !== generation) {
        generation = scope;
        reader.reset();
      }
      const read = await index.refresh(scope, signal);
      const complete = soupBackfillLaneCompleted(
        userId,
        CHANNEL_DIRECTORY_CHECKPOINT_ID,
        scope
      );
      const next = channelDirectoryState(
        read.channels,
        read.incompleteIds,
        complete
      );
      span.setAttr('channel_directory.records', read.channels.length);
      span.setAttr('channel_directory.joined', next.joined.length);
      span.setAttr('channel_directory.incomplete', read.incompleteIds.length);
      span.setAttr('channel_directory.reread', read.reread);
      span.setAttr('channel_directory.complete', complete);
      if (!sameState(untrack(state), next)) setState(next);
      // Before the lane finishes it fills these itself.
      if (complete)
        for (const id of read.incompleteIds.slice(
          0,
          INCOMPLETE_READS_PER_REFRESH
        ))
          reader.request(id);
    });

  const refresh = createSerialRunner(async () => {
    try {
      await readIndex();
    } catch (error) {
      if (controller.signal.aborted) return;
      Telemetry.error(error, { surface: 'channel-directory-refresh' });
    }
  });

  onCleanup(
    subscribeToVisibleCacheChanges(host, refresh, {
      searchBuckets: () => CHANNEL_SEARCH_BUCKET_LIST,
      intervalMs: ACCOUNT_WIDE_REFRESH_INTERVAL_MS,
    })
  );
  // Every page saves the checkpoint; only a finished pass changes what the
  // directory can answer.
  onCleanup(
    watchSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_CHECKPOINT_ID, () => {
      if (generation === undefined) return;
      const complete = soupBackfillLaneCompleted(
        userId,
        CHANNEL_DIRECTORY_CHECKPOINT_ID,
        generation
      );
      if (complete !== untrack(state).complete) refreshNow();
    })
  );
  // Never rejects: a failed read is reported inside.
  const refreshNow = () =>
    fireAndForget(refresh(), 'channel-directory-refresh');
  refreshNow();

  return {
    channels: () => state().joined,
    complete: () => state().complete,
    lookup(channelId) {
      const result = lookupChannel(state(), reader.outcomes(), channelId);
      if (result.status === 'pending') reader.request(channelId);
      return result;
    },
    async readComplete() {
      const current = untrack(state);
      if (current.complete) return current.joined;
      return deps.fetchAll();
    },
    failed: () => false,
    retry: () => {},
  };
}

type MemoryDirectoryDeps = {
  userId: string;
  client: () => UrqlQuery;
  queryClient: QueryClient;
};

/** The directory paged from the network into memory, for a session without
 * the cache. Complete once every page has loaded. */
export function createMemoryChannelDirectory(
  deps: MemoryDirectoryDeps
): ChannelDirectory {
  const options = () =>
    channelDirectoryPagesQueryOptions(deps.userId, deps.client);
  const pages = useQuery(options);
  const [overlay, setOverlay] = createSignal<
    Readonly<Record<string, DirectoryChannel>>
  >({});

  const reader = createByIdReader(async (ids, signal) => {
    const channels = await fetchChannelsById(deps.client(), ids, signal);
    signal.throwIfAborted();
    setOverlay((previous) => {
      const next = { ...previous };
      for (const channel of channels) next[channel.id] = channel;
      return next;
    });
    return new Set(channels.map(({ id }) => id));
  });

  const state = createMemo((): ChannelDirectoryState => {
    // Raw rows: walking them through the store creates a signal per field.
    if (queryReadyGate(pages))
      return channelDirectoryState(unwrap(pages.data), [], true);
    // The channels read by id stand in until every page has loaded.
    return channelDirectoryState(Object.values(overlay()), [], false);
  });

  return {
    channels: () => state().joined,
    complete: () => state().complete,
    lookup(channelId) {
      const result = lookupChannel(state(), reader.outcomes(), channelId);
      if (result.status === 'pending') reader.request(channelId);
      return result;
    },
    async readComplete() {
      const channels = await deps.queryClient.fetchQuery(options());
      return channels.filter(({ isParticipant }) => isParticipant);
    },
    failed: () => pages.isError && !pages.isFetching,
    retry: () => fireAndForget(pages.refetch(), 'channel-directory'),
  };
}

/** A directory with nothing in it, for a signed-out session. */
export const EMPTY_CHANNEL_DIRECTORY: ChannelDirectory = {
  channels: () => [],
  complete: () => false,
  lookup: () => PENDING,
  readComplete: async () => [],
  failed: () => false,
  retry: () => {},
};

/** A complete directory of `channels`, which may change, for tests and
 * fixtures that stand in for the app's. */
export function staticChannelDirectory(
  channels: Accessor<readonly DirectoryChannel[]>
): ChannelDirectory {
  const state = createMemo(() => channelDirectoryState(channels(), [], true));
  return {
    channels: () => state().joined,
    complete: () => true,
    lookup: (channelId) => lookupChannel(state(), {}, channelId),
    readComplete: async () => untrack(state).joined,
    failed: () => false,
    retry: () => {},
  };
}

/** The app's directory for the signed-in viewer: the cached one while the
 * cache and its backfill run, else the in-memory one. A new account, login
 * or cache host starts it over. */
export function createAppChannelDirectory(): ChannelDirectory {
  const account = useQueryAccount();
  const queryClient = useQueryClient();
  const accountKey = createMemo(() => {
    const current = account();
    return current ? `${current.session}:${current.userId}` : undefined;
  });
  // Read reactively: a session that abandons its cache falls back to memory.
  const host = createMemo(() => {
    const current = getGraphqlSoupCacheHost();
    return current && !current.disabled && ENABLE_GRAPHQL_BACKFILL
      ? current
      : undefined;
  });
  const directory = createMemo((): ChannelDirectory => {
    if (!accountKey()) return EMPTY_CHANNEL_DIRECTORY;
    const userId = untrack(account)?.userId;
    if (!userId) return EMPTY_CHANNEL_DIRECTORY;
    const cache = host();
    if (!cache)
      return createMemoryChannelDirectory({
        userId,
        client: getGraphqlSoupClient,
        queryClient,
      });
    return createCachedChannelDirectory({
      host: cache,
      userId,
      hydrate: (input, options) =>
        hydrateGraphqlSoup(
          SoupChannelDirectoryBackfillDocument,
          { input },
          options
        ),
      fetchAll: async () => {
        const channels = await queryClient.fetchQuery(
          channelDirectoryPagesQueryOptions(userId, getGraphqlSoupClient)
        );
        return channels.filter(({ isParticipant }) => isParticipant);
      },
    });
  });
  return {
    channels: () => directory().channels(),
    complete: () => directory().complete(),
    lookup: (channelId) => directory().lookup(channelId),
    readComplete: () => untrack(directory).readComplete(),
    failed: () => directory().failed(),
    retry: () => untrack(directory).retry(),
  };
}
