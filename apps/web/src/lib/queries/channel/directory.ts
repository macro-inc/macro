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
import { deepEqual } from '@core/util/compareUtils';
import { debounce, throttle } from '@core/util/debounce';
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
  hashKey,
  type QueryClient,
  type QueryKey,
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
import { isChannelId } from './channel-id';
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
import { isLaterView, stampCachedChannelView } from './viewed-at';

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
// The lane saves its checkpoint after every page, in whichever tab runs it.
// Silence this long before it finishes means it stalled (that tab closed or
// stopped mid-pass, or a request hung), and the directory pages the network
// itself rather than stay partial.
const LANE_STALL_MS = 30_000;
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
  /** Whether `channels` lists every joined channel the directory can know
   * of: the cached directory waits, after its lane's pass, for the by-id
   * read of each cached record that lacks a field. A read that failed still
   * completes it, so the cache answers offline; `readComplete` does not
   * trust such a directory. */
  complete: Accessor<boolean>;
  /** A joined channel, `pending` while the directory cannot tell yet. A
   * pending lookup reads the channel by id. */
  lookup: (channelId: string) => ChannelLookup;
  /** Every joined channel, read from the network unless the directory is
   * complete and no record it holds lacks a field it could not read. */
  readComplete: () => Promise<readonly DirectoryChannel[]>;
  /** Whether filling the directory failed and stays failed until `retry`.
   * The cached directory fails only when its backfill lane gave up and the
   * network's pages failed too. */
  failed: Accessor<boolean>;
  retry: () => void;
  /** Shows a view the viewer just recorded on the channel from now on, in
   * this tab's directory: no soup update carries it, and a read older than it
   * never moves it back here. Other tabs show it once a read of theirs
   * returns it (the cached directory also stamps the cached record). */
  recordView: (channelId: string, viewedAt: string) => void;
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
  // No channel has it, and no read could say so.
  if (!isChannelId(channelId)) return MISSING;
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

/**
 * The views the viewer recorded in this tab while the directory ran, laid
 * over every record it reads: the cache's, a by-id read's or a network page's, which may
 * have been read before the view. A record with a later view shows its own.
 */
function createViewStamps() {
  const [stamps, setStamps] = createSignal<Readonly<Record<string, string>>>(
    {}
  );
  // One copy per record read, so a state recomputed over the same records
  // keeps its channels' identity.
  const copies = new WeakMap<DirectoryChannel, DirectoryChannel>();
  const stamped = (channel: DirectoryChannel, viewedAt: string) => {
    const copy = copies.get(channel);
    if (copy?.viewedAt === viewedAt) return copy;
    const next = { ...channel, viewedAt };
    copies.set(channel, next);
    return next;
  };
  const later = (
    channel: DirectoryChannel,
    current: Readonly<Record<string, string>>
  ) => {
    const viewedAt = current[channel.id];
    return viewedAt !== undefined && isLaterView(channel.viewedAt, viewedAt)
      ? stamped(channel, viewedAt)
      : channel;
  };
  return {
    stamps,
    /** False when the directory already shows a view as late. */
    record(channelId: string, viewedAt: string) {
      const current = untrack(stamps)[channelId];
      if (current !== undefined && !isLaterView(current, viewedAt))
        return false;
      setStamps((previous) => ({ ...previous, [channelId]: viewedAt }));
      return true;
    },
    apply(state: ChannelDirectoryState): ChannelDirectoryState {
      const current = stamps();
      let records: Record<string, DirectoryChannel> | undefined;
      for (const id of Object.keys(current)) {
        const channel = state.records[id];
        if (!channel) continue;
        const next = later(channel, current);
        if (next === channel) continue;
        records ??= { ...state.records };
        records[id] = next;
      }
      if (!records) return state;
      const stampedRecords = records;
      return {
        ...state,
        records: stampedRecords,
        joined: state.joined.map(
          (channel) => stampedRecords[channel.id] ?? channel
        ),
      };
    },
    applyList(channels: readonly DirectoryChannel[]) {
      const current = untrack(stamps);
      if (Object.keys(current).length === 0) return channels;
      return channels.map((channel) => later(channel, current));
    },
  };
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
function fetchChannelsById(
  client: UrqlQuery,
  ids: readonly string[],
  signal: AbortSignal
): Promise<DirectoryPage> {
  return fetchDirectoryPage(
    client,
    readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
    signal
  );
}

/** Per query client, the channel writes `refreshChannelDirectory` has seen,
 * and how many it had seen when each directory read started. */
type DirectoryWrites = { seen: number; readFrom: Map<string, number> };

const DIRECTORY_WRITES = new WeakMap<QueryClient, DirectoryWrites>();

function directoryWrites(client: QueryClient): DirectoryWrites {
  const known = DIRECTORY_WRITES.get(client);
  if (known) return known;
  const created: DirectoryWrites = { seen: 0, readFrom: new Map() };
  DIRECTORY_WRITES.set(client, created);
  return created;
}

function readsBeforeWrite(client: QueryClient, queryKey: QueryKey) {
  const writes = directoryWrites(client);
  return (writes.readFrom.get(hashKey(queryKey)) ?? 0) < writes.seen;
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
    queryFn: ({ signal, client: queries, queryKey }) => {
      const writes = directoryWrites(queries);
      writes.readFrom.set(hashKey(queryKey), writes.seen);
      return fetchJoinedChannels(client(), signal);
    },
    staleTime: DIRECTORY_STALE_MS,
  });
}

/**
 * The directory's pages, read after the latest channel write. A read that
 * started before one may hold the pages before it, and nothing reads again
 * for a caller of `fetchQuery`: an invalidation refetches only observed
 * queries, and the read's success clears it. So it reads until a read began
 * after the latest write. The writes are this client's own, one per action
 * the viewer takes, so the reads end once the viewer pauses.
 */
export async function fetchCurrentDirectoryPages(
  client: QueryClient,
  options: ReturnType<typeof channelDirectoryPagesQueryOptions>
): Promise<readonly DirectoryChannel[]> {
  let channels = await client.fetchQuery(options);
  while (readsBeforeWrite(client, options.queryKey))
    channels = await client.fetchQuery({ ...options, staleTime: 0 });
  return channels;
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
  directoryWrites(client).seen += 1;
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
 * nothing about the ids it lacks; `unreadable` are ids to read again: ones
 * it returned whose records could not be read, or, without evidence, ones it
 * did not return. */
type ByIdRead = {
  returned: ReadonlySet<string> | undefined;
  unreadable?: readonly string[];
};

type ByIdReaderOptions = {
  /** Runs after reads settle, for an owner that reads `outcomes` untracked. */
  onSettle?: () => void;
};

/**
 * Coalesces by-id reads, at most `BY_ID_CONCURRENCY` batches at a time. Each
 * id is read once until `reset`, except that the ids whose reads failed are
 * forgotten together at most every `BY_ID_RETRY_AFTER_MS`, so a lookup still
 * asking for one reads it again within that time of its failure.
 */
export function createByIdReader(
  read: (ids: string[], signal: AbortSignal) => Promise<ByIdRead>,
  options: ByIdReaderOptions = {}
) {
  const [outcomes, setOutcomes] = createSignal<
    Readonly<Record<string, ByIdOutcome>>
  >({});
  // Every id a read settled since the last reset, failures included: a
  // failure forgotten for a retry stays settled.
  const [settled, setSettled] = createSignal<Readonly<Record<string, true>>>(
    {}
  );
  let requested = new Set<string>();
  let attempts = new Map<string, number>();
  let controller = new AbortController();

  const settle = (updates: Record<string, ByIdOutcome>) => {
    const ids = Object.keys(updates);
    if (ids.length === 0) return;
    setOutcomes((previous) => ({ ...previous, ...updates }));
    const known = untrack(settled);
    if (ids.some((id) => !known[id]))
      setSettled((previous) => {
        const next = { ...previous };
        for (const id of ids) next[id] = true;
        return next;
      });
    options.onSettle?.();
  };

  // Not a debounce: failures that keep arriving would postpone the retry of
  // earlier ones for as long as they arrive.
  const forgetFailures = throttle(() => {
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
        // Without evidence, the caller listed every id it lacks as unreadable.
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
    /** The ids a read has answered or given up on since the last reset. */
    settled,
    /** Queues a by-id read; false when the id was already requested. Never
     * writes a signal, so a reactive read may call it. */
    request(id: string) {
      if (!isChannelId(id) || requested.has(id)) return false;
      requested.add(id);
      batcher.addItem(id);
      return true;
    },
    /** Forgets every read, for a new storage generation. */
    reset() {
      drop();
      controller = new AbortController();
      requested = new Set();
      attempts = new Map();
      setOutcomes({});
      setSettled({});
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
  /** Every joined channel, for `readComplete` before the directory is
   * complete; may answer from a recent read. */
  fetchAll: () => Promise<readonly DirectoryChannel[]>;
  /** Every joined channel, paged from the network now, for the fallback. */
  pageAll: (signal: AbortSignal) => Promise<readonly DirectoryChannel[]>;
  /** Writes a recorded view onto the channel's cached record. */
  stampView: (channelId: string, viewedAt: string) => Promise<boolean>;
};

/** The joined channels paged from the network once the channel lane gave
 * up, so the directory can still complete. */
type LaneFallback =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; channels: readonly DirectoryChannel[] }
  | { status: 'failed' };

/** Why the directory paged the network itself. */
type FallbackReason = 'lane_failed' | 'lane_stalled' | 'retry';

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

/** A channel's record as the cache showed it after a change, or null once
 * the cache removed it. */
type ObservedChange = DirectoryChannel | null;

/** What the cache showed after the network's read of the joined channels
 * began, and what by-id reads found since its pages landed. */
export type FallbackEvidence = {
  /** Each record the cache changed or removed since the read began. */
  changes: ReadonlyMap<string, ObservedChange>;
  /** Every channel the cache held a record of at some read since. */
  seen: ReadonlySet<string>;
  /** How each by-id read since the pages landed ended. */
  confirmed: Readonly<Record<string, ByIdOutcome>>;
};

/**
 * The network's joined channels, updated by what the cache saw after the
 * network's read began:
 *
 * - A change the cache saw since is at least as new as the page that listed
 *   the channel.
 * - A listed record the cache held unchanged is as of before that read, so
 *   the network's row wins.
 * - A listed channel the cache never held may have gone since with nothing
 *   left in the cache for its removal to reach: the network's row stands
 *   until a by-id read finds the channel absent.
 * - A channel the network left out stays out, even when the cache changed
 *   its record (the viewer may have lost it with no removal reaching the
 *   cache, and a view stamp then rewrites it), unless a by-id read since
 *   returned it.
 */
export function fallbackChannels(
  network: readonly DirectoryChannel[],
  evidence: FallbackEvidence
): DirectoryChannel[] {
  const { changes, seen, confirmed } = evidence;
  const channels: DirectoryChannel[] = [];
  const listed = new Set<string>();
  for (const channel of network) {
    listed.add(channel.id);
    const change = changes.get(channel.id);
    if (change !== undefined) {
      if (change) channels.push(change);
    } else if (seen.has(channel.id) || confirmed[channel.id] !== 'absent') {
      channels.push(channel);
    }
  }
  for (const [id, change] of changes)
    if (change && !listed.has(id) && confirmed[id] === 'returned')
      channels.push(change);
  return channels;
}

/** The channels `fallbackChannels` decides by a by-id read: listed ones the
 * cache never held, and changed ones the network did not list. */
export function fallbackConfirmations(
  network: readonly DirectoryChannel[],
  evidence: FallbackEvidence
): string[] {
  const { changes, seen } = evidence;
  const ids: string[] = [];
  const listed = new Set<string>();
  for (const { id } of network) {
    listed.add(id);
    if (!seen.has(id) && !changes.has(id)) ids.push(id);
  }
  for (const [id, change] of changes)
    if (change && !listed.has(id)) ids.push(id);
  return ids;
}

function recordsById(read: ChannelDirectoryRead | undefined) {
  return new Map(
    (read?.channels ?? []).map((channel) => [channel.id, channel])
  );
}

/**
 * The directory read from the cache. Complete once a pass of the channel lane
 * finished in the cache's current storage generation and every joined record
 * lacking a field has settled its by-id read. If the lane gives up or stalls
 * first, the joined channels are paged from the network instead, and
 * `failed` says whether that failed too.
 */
export function createCachedChannelDirectory(
  deps: CachedDirectoryDeps
): ChannelDirectory {
  const { host, userId } = deps;
  const index = createChannelDirectoryIndex(host);
  const [state, setState] = createSignal(EMPTY_CHANNEL_DIRECTORY_STATE);
  const views = createViewStamps();
  const view = createMemo(() => views.apply(state()));
  // Cached records older than a recorded view that the view was written
  // over again: a soup page read before the view can overwrite it.
  const restamped = new WeakSet<DirectoryChannel>();
  const [fallback, setFallback] = createSignal<LaneFallback>({
    status: 'idle',
  });
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  // The network walk the fallback is waiting on, aborted when it stops.
  let walk: AbortController | undefined;
  onCleanup(() => walk?.abort());
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
  // While the network fallback runs: the records the last read found, what
  // changed in the cache after the fallback's read began, and every channel
  // the cache held since.
  let observed: Map<string, DirectoryChannel> | undefined;
  let changes: Map<string, ObservedChange> | undefined;
  let seen: Set<string> | undefined;
  // A fallback read that a later start or stop overtook settles nothing.
  let fallbackRun = 0;

  /** Reads channels by id into the cache and rereads their records. An id
   * the read returned without a record `hasRecord` sees is unreadable. */
  const readById = async (
    ids: string[],
    signal: AbortSignal,
    hasRecord: (id: string) => boolean
  ): Promise<ByIdRead> => {
    const page = await deps.hydrate(
      readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
      { signal }
    );
    // A lookup answers from the directory, so let it see the records first.
    for (const id of ids) wantKeys.add(`${CHANNEL_RECORD_PREFIX}${id}`);
    await runner();
    const returned = returnedChannelIds(ids, page);
    // Without evidence, an id with no record may still be the viewer's.
    if (!returned)
      return {
        returned: undefined,
        unreadable: ids.filter((id) => !hasRecord(id)),
      };
    return {
      returned,
      unreadable: [...returned].filter((id) => !hasRecord(id)),
    };
  };
  const reader = createByIdReader((ids, signal) =>
    readById(ids, signal, (id) => Boolean(untrack(state).records[id]))
  );
  // While the network's channels are shown: reads of those the cache cannot
  // vouch for. Their records land in the cache, so a returned channel reads
  // as the cache now holds it.
  const confirm = createByIdReader(
    (ids, signal) => readById(ids, signal, (id) => observed?.has(id) ?? false),
    { onSettle: () => render() }
  );

  /** Shows the last read and, once the network's channels loaded, those
   * channels as the evidence since leaves them. */
  const render = () => {
    const network = untrack(fallback);
    if (network.status !== 'loaded') {
      const next = lastRead
        ? channelDirectoryState(
            lastRead.channels,
            lastRead.incompleteIds,
            lane.complete
          )
        : EMPTY_CHANNEL_DIRECTORY_STATE;
      if (!sameState(untrack(state), next)) setState(next);
      return;
    }
    const evidence: FallbackEvidence = {
      changes: changes ?? new Map(),
      seen: seen ?? new Set(),
      confirmed: untrack(confirm.outcomes),
    };
    const next = channelDirectoryState(
      fallbackChannels(network.channels, evidence),
      lastRead?.incompleteIds ?? [],
      true
    );
    if (!sameState(untrack(state), next)) setState(next);
    // Only this viewer's cache can show what the reads returned.
    if (generation === undefined) return;
    for (const id of fallbackConfirmations(network.channels, evidence))
      confirm.request(id);
  };

  /** Notes each record this read found changed or removed since the last,
   * while the fallback runs. A record that now lacks a field is not a
   * change: it keeps what was seen of it. */
  const observe = (
    read: ChannelDirectoryRead,
    records: () => Map<string, DirectoryChannel>
  ) => {
    if (!observed || !changes) return;
    const next = records();
    for (const [id, channel] of next) {
      const before = observed.get(id);
      if (before !== channel && !deepEqual(before, channel))
        changes.set(id, channel);
    }
    const incomplete = new Set(read.incompleteIds);
    for (const id of observed.keys())
      if (!next.has(id) && !incomplete.has(id)) changes.set(id, null);
    for (const id of next.keys()) seen?.add(id);
    observed = next;
  };

  const stopFallback = () => {
    if (untrack(fallback).status === 'idle') return;
    walk?.abort();
    walk = undefined;
    fallbackRun += 1;
    observed = undefined;
    changes = undefined;
    seen = undefined;
    confirm.reset();
    setFallback({ status: 'idle' });
  };

  const stampView = (channelId: string, viewedAt: string) =>
    fireAndForget(deps.stampView(channelId, viewedAt), 'channel-view-stamp');

  /** Writes each recorded view again over a cached record older than it,
   * once per record read. */
  const restampOlderRecords = (
    records: () => Map<string, DirectoryChannel>
  ) => {
    const stamps = Object.entries(untrack(views.stamps));
    if (stamps.length === 0) return;
    const byId = records();
    for (const [id, viewedAt] of stamps) {
      const record = byId.get(id);
      if (!record || !isLaterView(record.viewedAt, viewedAt)) continue;
      if (restamped.has(record)) continue;
      restamped.add(record);
      stampView(id, viewedAt);
    }
  };

  const publish = (read: ChannelDirectoryRead) => {
    lastRead = read;
    // Built once, and only when one of them needs it.
    let byId: Map<string, DirectoryChannel> | undefined;
    const records = () => {
      byId ??= recordsById(read);
      return byId;
    };
    observe(read, records);
    restampOlderRecords(records);
    // A finished pass reconciled the cache: it answers alone again.
    if (lane.complete) stopFallback();
    render();
    // Before the lane finishes it fills these itself. Ids already requested
    // do not count, so ones that keep failing cannot hold back the rest.
    if (lane.complete) {
      let queued = 0;
      for (const id of read.incompleteIds) {
        if (queued >= INCOMPLETE_READS_PER_REFRESH) break;
        if (reader.request(id)) queued += 1;
      }
    }
    if (lane.failed) startFallback('lane_failed');
  };

  /** Pages the network once. It needs no write fence: a write during the
   * walk reaches the cache as a soup update or the mutation's returned
   * record, and `observe` lays every change since the walk began over the
   * pages it returns. */
  const loadFallback = (
    run: number,
    signal: AbortSignal,
    reason: FallbackReason
  ) =>
    Telemetry.span('channel_directory.fallback', async (span) => {
      span.setAttr('channel_directory.fallback_reason', reason);
      try {
        const channels = await deps.pageAll(signal);
        if (signal.aborted || run !== fallbackRun) return;
        setFallback({ status: 'loaded', channels });
        render();
      } catch (error) {
        if (signal.aborted || run !== fallbackRun) return;
        Telemetry.error(error, { surface: 'channel-directory-fallback' });
        setFallback({ status: 'failed' });
      }
    });
  const startFallback = (reason: FallbackReason) => {
    if (untrack(fallback).status !== 'idle') return;
    fallbackRun += 1;
    // Changes from here on are at least as new as the pages it reads.
    observed = recordsById(lastRead);
    changes = new Map();
    seen = new Set(observed.keys());
    confirm.reset();
    setFallback({ status: 'loading' });
    walk?.abort();
    walk = new AbortController();
    // Never rejects: a failed read is reported inside.
    fireAndForget(
      loadFallback(fallbackRun, walk.signal, reason),
      'channel-directory-fallback'
    );
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
      render();
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
  // Rearmed by every save of the lane's checkpoint. `lane` is read as soon
  // as the cache's scope is known, before the records are, so a slow scan
  // never pages the network for a lane that finished; a cache that cannot
  // say whose records it holds for this long does.
  const laneStalled = debounce(() => {
    if (!lane.complete) startFallback('lane_stalled');
  }, LANE_STALL_MS);
  onCleanup(
    host.onCacheGenerationChanged((change) => {
      if (change.storage === 'reset') {
        // The lane starts over in the new storage.
        laneStalled();
        // The records read so far went with the storage that held them.
        generation = undefined;
        lane = LANE_NOT_STARTED;
        lastRead = undefined;
        // What the new storage holds was written since, and what a by-id
        // read wrote into the old one is gone.
        if (observed) {
          observed = new Map();
          seen = new Set();
          confirm.reset();
        }
        reader.reset();
        adopted = undefined;
        render();
      }
      refreshNow();
    })
  );
  // Every page saves the checkpoint; only a finished pass, or the lane giving
  // up, changes what the directory can answer.
  onCleanup(
    watchSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_CHECKPOINT_ID, () => {
      laneStalled();
      if (generation === undefined) return;
      const next = readLaneProgress(userId, generation);
      if (next.complete !== lane.complete || next.failed !== lane.failed)
        refreshNow();
    })
  );
  laneStalled();
  refreshNow();

  // A complete pass of the lane proves the records it wrote, not those it
  // did not: a joined channel another query cached without every field is
  // listed only once its by-id read lands it.
  const completeness = createMemo((): 'partial' | 'unproven' | 'proven' => {
    const current = state();
    if (!current.complete) return 'partial';
    if (fallback().status === 'loaded') return 'proven';
    const outcomes = reader.outcomes();
    const settled = reader.settled();
    let unproven = false;
    for (const id of Object.keys(current.incomplete)) {
      // Never read: no channel has it.
      if (!isChannelId(id)) continue;
      if (!settled[id]) return 'partial';
      const outcome = outcomes[id];
      if (outcome !== 'returned' && outcome !== 'absent') unproven = true;
    }
    return unproven ? 'unproven' : 'proven';
  });

  return {
    channels: () => view().joined,
    complete: () => completeness() !== 'partial',
    lookup(channelId) {
      const result = lookupChannel(view(), reader.outcomes(), channelId);
      if (result.status === 'pending') reader.request(channelId);
      return result;
    },
    async readComplete() {
      if (untrack(completeness) === 'proven') return untrack(view).joined;
      return views.applyList(await deps.fetchAll());
    },
    failed: () => !state().complete && fallback().status === 'failed',
    retry() {
      if (untrack(fallback).status !== 'failed') return;
      setFallback({ status: 'idle' });
      startFallback('retry');
    },
    recordView(channelId, viewedAt) {
      if (views.record(channelId, viewedAt)) stampView(channelId, viewedAt);
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
    const page = await fetchChannelsById(deps.client(), ids, signal);
    signal.throwIfAborted();
    setOverlay((previous) => {
      const next = { ...previous };
      for (const channel of page.channels) next[channel.id] = channel;
      return next;
    });
    const listed = page.channels.map(({ id }) => id);
    const returned = returnedChannelIds(ids, {
      nextCursor: page.nextCursor,
      entityIds: listed,
    });
    if (returned) return { returned };
    const found = new Set(listed);
    return {
      returned: undefined,
      unreadable: ids.filter((id) => !found.has(id)),
    };
  });

  const views = createViewStamps();
  const read = createMemo((): ChannelDirectoryState => {
    // Raw rows: walking them through the store creates a signal per field.
    if (queryReadyGate(pages))
      return channelDirectoryState(unwrap(pages.data), [], true);
    // The channels read by id stand in until every page has loaded.
    return channelDirectoryState(Object.values(overlay()), [], false);
  });
  const state = createMemo(() => views.apply(read()));

  return {
    channels: () => state().joined,
    complete: () => state().complete,
    lookup(channelId) {
      const result = lookupChannel(state(), reader.outcomes(), channelId);
      if (result.status === 'pending') reader.request(channelId);
      return result;
    },
    async readComplete() {
      const channels = await fetchCurrentDirectoryPages(
        deps.queryClient,
        options()
      );
      return views.applyList(
        channels.filter(({ isParticipant }) => isParticipant)
      );
    },
    failed: () => pages.isError && !pages.isFetching,
    retry: () => fireAndForget(pages.refetch(), 'channel-directory'),
    recordView(channelId, viewedAt) {
      views.record(channelId, viewedAt);
    },
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
  recordView: () => {},
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
    recordView: () => {},
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
        const channels = await fetchCurrentDirectoryPages(
          queryClient,
          channelDirectoryPagesQueryOptions(userId, getGraphqlSoupClient)
        );
        return channels.filter(({ isParticipant }) => isParticipant);
      },
      pageAll: async (signal) => {
        const channels = await fetchJoinedChannels(
          getGraphqlSoupClient(),
          signal
        );
        return channels.filter(({ isParticipant }) => isParticipant);
      },
      stampView: (channelId, viewedAt) =>
        stampCachedChannelView(cache, channelId, viewedAt),
    });
  });
  return {
    channels: () => directory().channels(),
    complete: () => directory().complete(),
    lookup: (channelId) => directory().lookup(channelId),
    readComplete: () => untrack(directory).readComplete(),
    failed: () => directory().failed(),
    retry: () => untrack(directory).retry(),
    recordView: (channelId, viewedAt) =>
      untrack(directory).recordView(channelId, viewedAt),
  };
}
