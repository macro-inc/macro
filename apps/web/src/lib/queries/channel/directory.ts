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
import { debounce } from '@core/util/debounce';
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
import { promiseTimeout, until } from '@solid-primitives/promise';
import { AsyncQueuer, Batcher } from '@tanstack/pacer';
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
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from '../contacts/cache-scope';
import { queryReadyGate } from '../gate';
import {
  soupBackfillLaneCompleted,
  soupBackfillLaneFailed,
  watchSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import { ACCOUNT_WIDE_REFRESH_INTERVAL_MS } from '../visible-refresh';
import {
  CHANNEL_RECORD_PREFIX,
  CHANNEL_SEARCH_BUCKETS,
  type ChannelDirectoryRead,
  createChannelDirectoryIndex,
} from './directory-cache';
import { type DirectoryChannel, toDirectoryChannel } from './directory-core';
import {
  CHANNEL_DIRECTORY_CHECKPOINT_ID,
  CHANNEL_DIRECTORY_INPUT,
} from './directory-lane';
import {
  readableChannelsInput,
  returnedChannelIds,
} from './directory-reconcile';
import { channelKeys } from './keys';

// The server answers a by-id read of at most this many channels in one page.
const BY_ID_BATCH = 100;
const BY_ID_WAIT_MS = 25;
// A failed by-id read is tried once more before its channels count as
// failed, and read again after a pause while a lookup still asks for them.
const BY_ID_ATTEMPTS = 2;
const BY_ID_RETRY_AFTER_MS = 30_000;
// By-id batches read at once; more wait their turn.
const BY_ID_CONCURRENCY = 2;
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
   * The cached directory fails only when its backfill lane gave up and the
   * network's pages failed too. */
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

/** The channel's lookup once it stops being pending, or pending after
 * `timeoutMs`, for a one-time read such as rendering a mention to text. */
export async function settledChannelLookup(
  directory: Pick<ChannelDirectory, 'lookup'>,
  channelId: string,
  timeoutMs: number
): Promise<ChannelLookup> {
  const settled = until(() => {
    const lookup = directory.lookup(channelId);
    return lookup.status === 'pending' ? undefined : lookup;
  });
  // Not raceTimeout: its cleanup leaves a rejection unhandled when the
  // owner goes away first.
  try {
    return (
      (await Promise.race([settled, promiseTimeout(timeoutMs)])) ?? PENDING
    );
  } catch {
    // The owner that asked went away.
    return PENDING;
  } finally {
    settled.dispose();
  }
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
    // Each page after the first starts after an await, outside the span.
    const context = Telemetry.captureContext();
    const channels = new Map<string, DirectoryChannel>();
    let input: GraphqlSoupInput = { initial: CHANNEL_DIRECTORY_INPUT };
    let pages = 0;
    for (;;) {
      signal?.throwIfAborted();
      const page = await context.run(() =>
        fetchDirectoryPage(client, input, signal)
      );
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

/**
 * Re-reads the in-memory directory after a channel change. The cached
 * directory needs nothing: the server's soup updates keep it current.
 *
 * Invalidating a first read still in flight joins it, and its success clears
 * the invalidation, though it may have read the pages before the change. So
 * such a read is awaited and then read again.
 */
export async function refreshChannelDirectory(
  client: QueryClient = queryClient
) {
  const filters = { queryKey: channelKeys.directory._def };
  const firstReads = client
    .getQueryCache()
    .findAll(filters)
    .flatMap((query) =>
      query.state.fetchStatus !== 'idle' &&
      query.state.data === undefined &&
      query.promise
        ? [query.promise]
        : []
    );
  await client.invalidateQueries(filters);
  if (firstReads.length === 0) return;
  await Promise.allSettled(firstReads);
  await client.invalidateQueries(filters);
}

/** What a by-id read found. `returned` is undefined when the answer proves
 * nothing about the ids it lacks; `unreadable` are ids it returned whose
 * records could not be read, to be read again. */
type ByIdRead = {
  returned: ReadonlySet<string> | undefined;
  unreadable?: readonly string[];
};

/**
 * Coalesces by-id reads, at most `BY_ID_CONCURRENCY` batches at a time. Each
 * id is read once until `reset`, except that an id whose reads failed is
 * forgotten `BY_ID_RETRY_AFTER_MS` after the last failure, so a lookup still
 * asking for it reads it again.
 */
function createByIdReader(
  read: (ids: string[], signal: AbortSignal) => Promise<ByIdRead>
) {
  const [outcomes, setOutcomes] = createSignal<
    Readonly<Record<string, ByIdOutcome>>
  >({});
  let requested = new Set<string>();
  let attempts = new Map<string, number>();
  let controller = new AbortController();

  const settle = (updates: Record<string, ByIdOutcome>) => {
    if (Object.keys(updates).length === 0) return;
    setOutcomes((previous) => ({ ...previous, ...updates }));
  };

  const forgetFailures = debounce(() => {
    const failed = Object.entries(untrack(outcomes)).flatMap(([id, outcome]) =>
      outcome === 'failed' ? [id] : []
    );
    if (failed.length === 0) return;
    for (const id of failed) {
      requested.delete(id);
      attempts.delete(id);
    }
    setOutcomes((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([, outcome]) => outcome !== 'failed')
      )
    );
  }, BY_ID_RETRY_AFTER_MS);

  const retryOrFail = (ids: readonly string[]) => {
    const failed: Record<string, ByIdOutcome> = {};
    for (const id of ids) {
      const tried = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, tried);
      if (tried < BY_ID_ATTEMPTS) batcher.addItem(id);
      else failed[id] = 'failed';
    }
    settle(failed);
    if (Object.keys(failed).length > 0) forgetFailures();
  };

  // A batch never rejects: a read that a reset aborted settles nothing, and
  // a failed one is retried or marked failed here.
  const readBatch = async (ids: string[]) => {
    const signal = controller.signal;
    if (signal.aborted) return;
    try {
      const found = await Telemetry.span(
        'channel_directory.by_id',
        async (span) => {
          span.setAttr('channel_directory.requested', ids.length);
          const result = await read(ids, signal);
          span.setAttr(
            'channel_directory.returned',
            result.returned?.size ?? -1
          );
          span.setAttr(
            'channel_directory.unreadable',
            result.unreadable?.length ?? 0
          );
          return result;
        }
      );
      if (signal.aborted) return;
      const unreadable = new Set(found.unreadable);
      const updates: Record<string, ByIdOutcome> = {};
      for (const id of ids) {
        if (unreadable.has(id)) continue;
        updates[id] =
          !found.returned || found.returned.has(id) ? 'returned' : 'absent';
      }
      settle(updates);
      if (unreadable.size > 0) retryOrFail([...unreadable]);
    } catch (error) {
      if (signal.aborted) return;
      Telemetry.error(error, { surface: 'channel-directory-by-id' });
      retryOrFail(ids);
    }
  };

  const queuer = new AsyncQueuer<string[]>(readBatch, {
    concurrency: BY_ID_CONCURRENCY,
    onError: (error) =>
      Telemetry.error(error, { surface: 'channel-directory-by-id' }),
  });
  const batcher = new Batcher<string>((ids) => queuer.addItem(ids), {
    wait: BY_ID_WAIT_MS,
    maxSize: BY_ID_BATCH,
  });
  const drop = () => {
    controller.abort();
    batcher.cancel();
    batcher.clear();
    queuer.clear();
    forgetFailures.clear();
  };
  onCleanup(() => {
    drop();
    queuer.stop();
  });

  return {
    outcomes,
    /** Queues a by-id read. Never writes a signal, so a reactive read may
     * call it. */
    request(id: string) {
      if (requested.has(id)) return;
      requested.add(id);
      batcher.addItem(id);
    },
    /** Forgets every read, for a new storage generation. */
    reset() {
      drop();
      controller = new AbortController();
      requested = new Set();
      attempts = new Map();
      setOutcomes({});
    },
  };
}

/** Runs `run` one at a time; a request during a run, or a run that resolves
 * true, runs it again after. The promise settles once a run that started
 * after the request ends. */
function createSerialRunner(run: () => Promise<boolean>) {
  let running: Promise<void> | undefined;
  let again = false;
  const loop = async () => {
    try {
      do {
        again = false;
        const rerun = await run();
        again ||= rerun;
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
    | 'onCacheGenerationChanged'
  >;
  userId: string;
  hydrate: (
    input: GraphqlSoupInput,
    options: Pick<FetchGraphqlSoupOptions, 'signal'>
  ) => Promise<GraphqlSoupHydrationPage>;
  fetchAll: () => Promise<readonly DirectoryChannel[]>;
};

/** The joined channels paged from the network once the channel lane gave
 * up, so the directory can still complete. */
type LaneFallback =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; channels: readonly DirectoryChannel[] }
  | { status: 'failed' };

/** What the channel lane's checkpoint says of the current storage
 * generation. */
type LaneProgress = { complete: boolean; failed: boolean };

const LANE_NOT_STARTED: LaneProgress = { complete: false, failed: false };

function readLaneProgress(
  userId: string,
  storageGeneration: string
): LaneProgress {
  const complete = soupBackfillLaneCompleted(
    userId,
    CHANNEL_DIRECTORY_CHECKPOINT_ID,
    storageGeneration
  );
  return {
    complete,
    failed:
      !complete &&
      soupBackfillLaneFailed(
        userId,
        CHANNEL_DIRECTORY_CHECKPOINT_ID,
        storageGeneration
      ),
  };
}

/** The cached records, plus the network's channels the cache lacks. A cached
 * record follows soup updates; the network's list is as of its read. */
function withNetworkChannels(
  cached: readonly DirectoryChannel[],
  network: readonly DirectoryChannel[]
): DirectoryChannel[] {
  const ids = new Set(cached.map(({ id }) => id));
  return [...cached, ...network.filter(({ id }) => !ids.has(id))];
}

/**
 * The directory read from the cache. Complete once a pass of the channel lane
 * finished in the cache's current storage generation. If the lane gives up
 * first, the joined channels are paged from the network instead, and
 * `failed` says whether that failed too.
 */
export function createCachedChannelDirectory(
  deps: CachedDirectoryDeps
): ChannelDirectory {
  const { host, userId } = deps;
  const index = createChannelDirectoryIndex(host);
  const [state, setState] = createSignal(EMPTY_CHANNEL_DIRECTORY_STATE);
  const [fallback, setFallback] = createSignal<LaneFallback>({
    status: 'idle',
  });
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  let generation: string | undefined;
  // The cache the by-id reads answered for: a storage generation, null for
  // another viewer's, undefined before the first read or after a reset.
  let adopted: string | null | undefined;
  // As of the last full read, which alone may promote completeness.
  let lane = LANE_NOT_STARTED;
  let lastRead: ChannelDirectoryRead | undefined;
  // A full read lists every cached record; a keys read rereads only the
  // records a by-id read wrote.
  let wantFull = true;
  const wantKeys = new Set<string>();

  const reader = createByIdReader(async (ids, signal) => {
    const page = await deps.hydrate(
      readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
      { signal }
    );
    // A lookup answers from the directory, so let it see the records first.
    for (const id of ids) wantKeys.add(`${CHANNEL_RECORD_PREFIX}${id}`);
    await runner();
    const returned = returnedChannelIds(ids, page);
    if (!returned) return { returned: undefined };
    const records = untrack(state).records;
    return {
      returned,
      unreadable: [...returned].filter((id) => !records[id]),
    };
  });

  /** What the directory holds without a cache read: the network's channels
   * once the lane gave up and they loaded, else nothing. */
  const networkState = () => {
    const network = untrack(fallback);
    return network.status === 'loaded'
      ? channelDirectoryState(network.channels, [], true)
      : EMPTY_CHANNEL_DIRECTORY_STATE;
  };

  const publish = (read: ChannelDirectoryRead) => {
    lastRead = read;
    const network = untrack(fallback);
    const networkChannels =
      !lane.complete && network.status === 'loaded'
        ? network.channels
        : undefined;
    const next = channelDirectoryState(
      networkChannels
        ? withNetworkChannels(read.channels, networkChannels)
        : read.channels,
      read.incompleteIds,
      lane.complete || networkChannels !== undefined
    );
    if (!sameState(untrack(state), next)) setState(next);
    // Before the lane finishes it fills these itself.
    if (lane.complete)
      for (const id of read.incompleteIds.slice(
        0,
        INCOMPLETE_READS_PER_REFRESH
      ))
        reader.request(id);
    if (lane.failed) startFallback();
  };

  const loadFallback = async () => {
    const signal = controller.signal;
    try {
      const channels = await deps.fetchAll();
      if (signal.aborted) return;
      setFallback({ status: 'loaded', channels });
      if (lastRead) publish(lastRead);
      else setState(networkState());
    } catch (error) {
      if (signal.aborted) return;
      Telemetry.error(error, { surface: 'channel-directory-fallback' });
      setFallback({ status: 'failed' });
    }
  };
  const startFallback = () => {
    if (untrack(fallback).status !== 'idle') return;
    setFallback({ status: 'loading' });
    // Never rejects: a failed read is reported inside.
    fireAndForget(loadFallback(), 'channel-directory-fallback');
  };

  /** The cache's storage generation while it holds this viewer's records,
   * adopted as the directory's; undefined for another viewer's cache. */
  const adoptScope = async (signal: AbortSignal) => {
    const scope = await readContactCacheScope(host, userId, signal);
    // A lookup made before the first read keeps its by-id read.
    if (adopted !== undefined && adopted !== (scope ?? null)) reader.reset();
    adopted = scope ?? null;
    generation = scope;
    if (scope === undefined) {
      // Another viewer's cache: nothing in it is this viewer's.
      lane = LANE_NOT_STARTED;
      lastRead = undefined;
      setState(networkState());
    }
    return scope;
  };

  const readIndex = () =>
    Telemetry.span('channel_directory.refresh', async (span) => {
      const signal = controller.signal;
      const scope = await adoptScope(signal);
      if (scope === undefined) {
        span.setAttr('channel_directory.scope', 'other_viewer');
        return;
      }
      // Read before the scan: a pass that finishes during it may have
      // written records the scan missed, and its save reads again.
      lane = readLaneProgress(userId, scope);
      const read = await index.refresh(scope, signal);
      // The cache may have changed hands while it was read.
      await assertContactCacheScope(host, userId, scope, signal);
      span.setAttr('channel_directory.records', read.channels.length);
      span.setAttr('channel_directory.incomplete', read.incompleteIds.length);
      span.setAttr('channel_directory.reread', read.reread);
      span.setAttr('channel_directory.complete', lane.complete);
      span.setAttr('channel_directory.lane_failed', lane.failed);
      publish(read);
    });

  /** Rereads these records; false when a full read has to run instead. */
  const readKeys = (keys: readonly string[]) =>
    Telemetry.span('channel_directory.read_keys', async (span) => {
      span.setAttr('channel_directory.keys', keys.length);
      const signal = controller.signal;
      const scope = await readContactCacheScope(host, userId, signal);
      if (scope === undefined || scope !== generation) return false;
      const read = await index.readKeys(scope, keys, signal);
      if (!read) return false;
      await assertContactCacheScope(host, userId, scope, signal);
      publish(read);
      return true;
    });

  const runner = createSerialRunner(async () => {
    try {
      if (wantFull || generation === undefined) {
        wantFull = false;
        wantKeys.clear();
        await readIndex();
      } else if (wantKeys.size > 0) {
        const keys = [...wantKeys];
        wantKeys.clear();
        if (!(await readKeys(keys))) wantFull = true;
      }
    } catch (error) {
      if (controller.signal.aborted) return false;
      // Read again in the cache's new hands.
      if (error instanceof ContactDirectoryScopeError) wantFull = true;
      else Telemetry.error(error, { surface: 'channel-directory-refresh' });
    }
    return wantFull || wantKeys.size > 0;
  });
  const refresh = () => {
    wantFull = true;
    return runner();
  };
  // Never rejects: a failed read is reported inside.
  const refreshNow = () =>
    fireAndForget(refresh(), 'channel-directory-refresh');

  onCleanup(
    subscribeToVisibleCacheChanges(host, refresh, {
      searchBuckets: () => CHANNEL_SEARCH_BUCKET_LIST,
      intervalMs: ACCOUNT_WIDE_REFRESH_INTERVAL_MS,
    })
  );
  onCleanup(
    host.onCacheGenerationChanged((change) => {
      if (change.storage === 'reset') {
        // The records read so far went with the storage that held them.
        generation = undefined;
        lane = LANE_NOT_STARTED;
        lastRead = undefined;
        reader.reset();
        adopted = undefined;
        setState(networkState());
      }
      refreshNow();
    })
  );
  // Every page saves the checkpoint; only a finished pass, or the lane giving
  // up, changes what the directory can answer.
  onCleanup(
    watchSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_CHECKPOINT_ID, () => {
      if (generation === undefined) return;
      const next = readLaneProgress(userId, generation);
      if (next.complete !== lane.complete || next.failed !== lane.failed)
        refreshNow();
    })
  );
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
    failed: () => fallback().status === 'failed',
    retry() {
      if (untrack(fallback).status !== 'failed') return;
      setFallback({ status: 'idle' });
      startFallback();
    },
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
    return { returned: new Set(channels.map(({ id }) => id)) };
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
