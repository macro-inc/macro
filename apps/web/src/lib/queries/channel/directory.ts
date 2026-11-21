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
import { abortedBy } from '@core/util/abort-signal';
import { deepEqual } from '@core/util/compareUtils';
import { debounce, throttle } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import {
  ChannelDirectoryPageDocument,
  type ChannelDirectoryPageQuery,
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
import type { Client, OperationResult } from '@urql/core';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import {
  concat,
  filter,
  fromValue,
  map,
  merge,
  pipe,
  take,
  toPromise,
} from 'wonka';
import { useQueryAccount } from '../auth/use-query-account';
import { queryClient } from '../client';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from '../contacts/cache-scope';
import { queryReadyGate } from '../gate';
import {
  loadSoupBackfillCheckpoint,
  type SoupBackfillCheckpoint,
  soupBackfillLaneCompleted,
  soupBackfillLaneFailed,
  watchSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import {
  ACCOUNT_WIDE_REFRESH_INTERVAL_MS,
  createHiddenDeferral,
} from '../visible-refresh';
import { isChannelId } from './channel-id';
import {
  CHANNEL_RECORD_PREFIX,
  CHANNEL_SEARCH_BUCKETS,
  type ChannelDirectoryRead,
  createChannelDirectoryIndex,
  type RecordVersion,
  sameRecordVersion,
} from './directory-cache';
import {
  type DirectoryChannel,
  inDirectoryOrder,
  toDirectoryChannel,
} from './directory-core';
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
// The fallback's by-id reads settle a batch at a time; the channels they
// decide are laid over the network's at most this often.
const CONFIRM_RENDER_MS = 250;
// The lane saves its checkpoint after every page, in whichever tab runs it.
// Silence this long before it finishes means it stalled (that tab closed or
// stopped mid-pass, or a request hung), and the directory pages the network
// itself rather than stay partial.
const LANE_STALL_MS = 30_000;
/** How long the network fallback waits for the cache to write the pages it
 * read before reading them back: each channel the cache still lacks then
 * waits on a by-id read. */
const FALLBACK_PERSIST_WAIT_MS = 10_000;
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
  /** The channels the viewer joined, in the REST list's order. */
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
  /** The channels the viewer joined, newest update first as the REST list
   * ordered them; partial until `complete`. */
  channels: Accessor<readonly DirectoryChannel[]>;
  /** Whether `channels` lists every joined channel and no other. After its
   * lane's pass the cached directory waits for the by-id read of each cached
   * record that lacks a field; after paging the network itself, for the
   * by-id read of each channel the cache could not vouch for. A read that
   * failed keeps it incomplete until a later read answers. */
  complete: Accessor<boolean>;
  /** A joined channel, `pending` while the directory cannot tell yet. A
   * pending lookup reads the channel by id. */
  lookup: (channelId: string) => ChannelLookup;
  /** Every joined channel, read from the network unless the directory is
   * complete. */
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
  /** Whether every record shows the viewer's views as of this page's load or
   * later. No soup update carries a view, so a cached record keeps the one it
   * was read with until a pass of the channel lane rereads it: the cached
   * directory is current once a pass that started after the page loaded has
   * finished. The in-memory one read its pages in this page. */
  viewsCurrent: Accessor<boolean>;
};

export const EMPTY_CHANNEL_DIRECTORY_STATE: ChannelDirectoryState = {
  records: {},
  joined: [],
  incomplete: {},
  complete: false,
};

const PENDING: ChannelLookup = { status: 'pending' };
const MISSING: ChannelLookup = { status: 'missing' };
const NO_IDS: Readonly<Record<string, true>> = {};

/** The answer for one channel. A complete directory holds every joined
 * channel, so a channel it lacks is not joined; a cached record that lacks
 * a field waits for its by-id read, and so does a channel the directory
 * left out until a read decides it (`unconfirmed`). A row the directory
 * shows answers loaded even while a read decides whether it stays, as
 * `channels` lists it. An unjoined channel is missing, as it was from the
 * REST channel list. */
export function lookupChannel(
  state: ChannelDirectoryState,
  outcomes: Readonly<Record<string, ByIdOutcome>>,
  channelId: string,
  unconfirmed: Readonly<Record<string, true>> = NO_IDS
): ChannelLookup {
  const channel = state.records[channelId];
  if (channel) {
    if (channel.isParticipant) return { status: 'loaded', channel };
    // A by-id read is deciding it: the viewer may have joined it again.
    return unconfirmed[channelId] ? PENDING : MISSING;
  }
  // No channel has it, and no read could say so.
  if (!isChannelId(channelId)) return MISSING;
  if (unconfirmed[channelId]) return PENDING;
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
  return { records, joined: inDirectoryOrder(joined), incomplete, complete };
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

function sameIds(
  a: Readonly<Record<string, true>>,
  b: Readonly<Record<string, true>>
) {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => b[id]);
}

function sameState(a: ChannelDirectoryState, b: ChannelDirectoryState) {
  if (a === b) return true;
  if (a.complete !== b.complete) return false;
  const aIds = Object.keys(a.records);
  if (aIds.length !== Object.keys(b.records).length) return false;
  if (aIds.some((id) => a.records[id] !== b.records[id])) return false;
  return sameIds(a.incomplete, b.incomplete);
}

type UrqlQuery = Pick<Client, 'query'>;

type DirectoryPage = {
  channels: DirectoryChannel[];
  nextCursor: string | null;
  /** Settles, never rejecting, once the cache wrote the page; undefined
   * when the answer did not come from the network through the cache. */
  persisted: Promise<unknown> | undefined;
};

/** Every joined channel paged from the network, and the cache's writes of
 * those pages. */
export type JoinedChannelsWalk = {
  channels: DirectoryChannel[];
  /** How many pages the walk read. */
  pages: number;
  /** How many of those pages the cache wrote, once each write settled;
   * never rejects. A page the cache did not answer, or whose write it
   * skipped or failed, does not count. */
  written: Promise<number>;
};

/** A walk the fallback shows: the joined channels and the cache's writes. */
type FallbackWalk = Omit<JoinedChannelsWalk, 'channels'> & {
  channels: readonly DirectoryChannel[];
};

type DirectoryPageSettled =
  | {
      kind: 'answered';
      result: OperationResult<ChannelDirectoryPageQuery>;
    }
  | { kind: 'ended' }
  | { kind: 'aborted' };

/** One network page of the directory's query, without the cache. An abort
 * leaves the query's result source, which is what ends urql's request: urql
 * replaces a `fetchOptions.signal` with its own. */
async function fetchDirectoryPage(
  client: UrqlQuery,
  input: GraphqlSoupInput,
  signal: AbortSignal | undefined
): Promise<DirectoryPage> {
  const settled = await pipe(
    merge<DirectoryPageSettled>([
      concat<DirectoryPageSettled>([
        pipe(
          client.query(
            ChannelDirectoryPageDocument,
            { input },
            { requestPolicy: 'network-only' }
          ),
          // The answer, as urql's own toPromise takes it.
          filter((result) => !result.stale && !result.hasNext),
          map((result) => ({ kind: 'answered' as const, result }))
        ),
        fromValue({ kind: 'ended' as const }),
      ]),
      pipe(
        abortedBy(signal),
        map(() => ({ kind: 'aborted' as const }))
      ),
    ]),
    take(1),
    toPromise
  );
  if (settled.kind === 'aborted') {
    signal?.throwIfAborted();
    throw new Error('Channel directory page read was cancelled');
  }
  if (settled.kind === 'ended')
    throw new Error('Channel directory page read ended without an answer');
  const { result } = settled;
  if (result.error) throw result.error;
  const soup = result.data?.user.soup;
  if (!soup) throw new Error('Channel directory page returned no data');
  const metadata = normalizedCacheResultMetadata(result);
  return {
    channels: soup.items.flatMap((item) =>
      item.__typename === 'GraphqlSoupChannel' ? [toDirectoryChannel(item)] : []
    ),
    nextCursor: soup.nextCursor,
    persisted:
      metadata?.source === 'live-network' ? metadata.persistence : undefined,
  };
}

/** Pages every joined channel from the network, the lane's input to its
 * last page. The cache writes each page after answering it. */
export async function pageJoinedChannels(
  client: UrqlQuery,
  signal?: AbortSignal
): Promise<JoinedChannelsWalk> {
  return Telemetry.span('channel_directory.page_all', async (span) => {
    // Each page after the first starts after an await, outside the span.
    const context = Telemetry.captureContext();
    const channels = new Map<string, DirectoryChannel>();
    const writes: Promise<unknown>[] = [];
    let input: GraphqlSoupInput = { initial: CHANNEL_DIRECTORY_INPUT };
    let pages = 0;
    for (;;) {
      signal?.throwIfAborted();
      const page = await context.run(() =>
        fetchDirectoryPage(client, input, signal)
      );
      pages += 1;
      if (page.persisted) writes.push(page.persisted);
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
    // The exchange answers a write it skipped or failed with no revision.
    const countWritten = async () =>
      (await Promise.all(writes)).filter((revision) => revision !== undefined)
        .length;
    return {
      channels: [...channels.values()],
      pages,
      written: countWritten(),
    };
  });
}

/** `pageJoinedChannels`'s channels, for a reader that does not read them
 * back from the cache. */
export async function fetchJoinedChannels(
  client: UrqlQuery,
  signal?: AbortSignal
): Promise<DirectoryChannel[]> {
  const { channels } = await pageJoinedChannels(client, signal);
  return channels;
}

/** What `work` resolved to, if it settled within `timeoutMs`; undefined
 * once that passed, or at once when `signal` aborts. `work` must never
 * reject. */
async function settledWithin<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<T | undefined> {
  const listening = new AbortController();
  const late = async () => {
    await promiseTimeout(timeoutMs);
    return undefined;
  };
  const aborted = new Promise<undefined>((resolve) => {
    if (signal.aborted) resolve(undefined);
    signal.addEventListener('abort', () => resolve(undefined), {
      once: true,
      signal: listening.signal,
    });
  });
  try {
    return await Promise.race([work, late(), aborted]);
  } finally {
    listening.abort();
  }
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
  /** What the cache holds of the channel's record now. A read that finds a
   * channel absent answers for its record as it was when the read was sent:
   * one the cache changed before the answer settles is read again, as a
   * failed read is, and `renewChanged` forgets an absence whose record
   * changed since. */
  version?: (id: string) => RecordVersion;
};

/**
 * Coalesces by-id reads, at most `BY_ID_CONCURRENCY` batches at a time. Each
 * id is read once until `reset` or `renew`, except that the ids whose reads
 * failed are read again together at most every `BY_ID_RETRY_AFTER_MS`, with
 * nobody asking: an owner waiting on them may hear of nothing else. A hidden
 * tab holds that read until it is shown. With `version`, an absence holds
 * only while the channel's record stays as it was when its read was sent.
 */
export function createByIdReader(
  read: (ids: string[], signal: AbortSignal) => Promise<ByIdRead>,
  options: ByIdReaderOptions = {}
) {
  const [outcomes, setOutcomes] = createSignal<
    Readonly<Record<string, ByIdOutcome>>
  >({});
  let requested = new Set<string>();
  let attempts = new Map<string, number>();
  // For each absence, the record its read was sent against.
  let sentAgainst = new Map<string, RecordVersion>();
  let controller = new AbortController();
  const versionOf = options.version;

  const settle = (updates: Record<string, ByIdOutcome>) => {
    const ids = Object.keys(updates);
    if (ids.length === 0) return;
    setOutcomes((previous) => ({ ...previous, ...updates }));
    options.onSettle?.();
  };

  // The ids stay requested, so a lookup asking meanwhile queues nothing.
  const retryFailures = () => {
    const failed = Object.entries(untrack(outcomes)).flatMap(([id, outcome]) =>
      outcome === 'failed' ? [id] : []
    );
    if (failed.length === 0) return;
    for (const id of failed) attempts.delete(id);
    setOutcomes((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([, outcome]) => outcome !== 'failed')
      )
    );
    for (const id of failed) batcher.addItem(id);
  };
  const whileShown = createHiddenDeferral(retryFailures);
  // Not a debounce: failures that keep arriving would postpone the retry of
  // earlier ones for as long as they arrive.
  const forgetFailures = throttle(
    () => whileShown.request(),
    BY_ID_RETRY_AFTER_MS
  );

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
    const before = new Map(ids.map((id) => [id, versionOf?.(id)]));
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
      const rewritten: string[] = [];
      for (const id of ids) {
        if (unreadable.has(id)) continue;
        // Without evidence, the caller listed every id it lacks as unreadable.
        if (!found.returned || found.returned.has(id)) {
          updates[id] = 'returned';
          sentAgainst.delete(id);
        } else if (
          versionOf &&
          !sameRecordVersion(before.get(id), versionOf(id))
        ) {
          // The cache wrote it while the server answered: the viewer may
          // have joined it since.
          rewritten.push(id);
        } else {
          updates[id] = 'absent';
          sentAgainst.set(id, before.get(id));
        }
      }
      settle(updates);
      // Read again like a failed read, so a record the cache keeps rewriting
      // costs at most a read every `BY_ID_RETRY_AFTER_MS`.
      const again = [...unreadable, ...rewritten];
      if (again.length > 0) retryOrFail(again);
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
    whileShown.dispose();
  });

  const renew = (ids: readonly string[]) => {
    const current = untrack(outcomes);
    const settled = new Set(
      ids.filter((id) => current[id] === 'returned' || current[id] === 'absent')
    );
    if (settled.size === 0) return;
    for (const id of settled) {
      requested.delete(id);
      attempts.delete(id);
      sentAgainst.delete(id);
    }
    setOutcomes((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([id]) => !settled.has(id))
      )
    );
  };

  return {
    outcomes,
    /** Queues a by-id read; false when the id was already requested. Never
     * writes a signal, so a reactive read may call it. */
    request(id: string) {
      if (!isChannelId(id) || requested.has(id)) return false;
      requested.add(id);
      batcher.addItem(id);
      return true;
    },
    /** Forgets what the reads of these ids settled, so asking reads them
     * again: each answered for a record the cache has changed since. Reads
     * that failed or are under way are left alone. */
    renew,
    /** Forgets each absence whose record `version` now shows changed since
     * its read was sent, so asking reads it again. */
    renewChanged() {
      if (!versionOf) return;
      const changed: string[] = [];
      for (const [id, sent] of sentAgainst)
        if (!sameRecordVersion(sent, versionOf(id))) changed.push(id);
      renew(changed);
    },
    /** Forgets every read, for a new storage generation. */
    reset() {
      drop();
      controller = new AbortController();
      requested = new Set();
      attempts = new Map();
      sentAgainst = new Map();
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
  /** Every joined channel, for `readComplete` before the directory is
   * complete; may answer from a recent read. */
  fetchAll: () => Promise<readonly DirectoryChannel[]>;
  /** Every joined channel, paged from the network now, for the fallback,
   * and the cache's writes of its pages. */
  pageAll: (signal: AbortSignal) => Promise<FallbackWalk>;
  /** Writes a recorded view onto the channel's cached record. */
  stampView: (channelId: string, viewedAt: string) => Promise<boolean>;
  /** When this page loaded, in epoch milliseconds: records a pass of the
   * lane reread after it show views as current as `ChannelDirectory`
   * promises. `performance.timeOrigin` when left out. */
  sessionStartedAt?: number;
};

/** The joined channels paged from the network once the channel lane gave
 * up, so the directory can still complete. */
type LaneFallback =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; channels: readonly DirectoryChannel[] }
  | { status: 'failed' };

/** What the cached directory shows, written at once so that no reader pairs
 * one part with another's older value. */
type ShownDirectory = {
  state: ChannelDirectoryState;
  /** The fallback's status `state` was built for. */
  fallback: LaneFallback['status'];
  /** The channels the fallback waits on a by-id read to decide, by id. */
  unconfirmed: Readonly<Record<string, true>>;
};

/** Why the directory paged the network itself. */
type FallbackReason =
  | 'lane_failed'
  | 'lane_stalled'
  | 'retry'
  // The storage reset or the cache changed hands under it.
  | 'scope_changed';

/** What the channel lane's checkpoint says of the current storage
 * generation. `viewsCurrent`: a pass that started at or after
 * `sessionStartedAt` has finished, so it reread every record. */
type LaneProgress = {
  complete: boolean;
  failed: boolean;
  viewsCurrent: boolean;
};

const LANE_NOT_STARTED: LaneProgress = {
  complete: false,
  failed: false,
  viewsCurrent: false,
};

function readLaneProgress(
  userId: string,
  storageGeneration: string,
  sessionStartedAt: number
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
    viewsCurrent:
      complete &&
      laneReadSince(
        loadSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_CHECKPOINT_ID),
        sessionStartedAt
      ),
  };
}

/** Whether the lane's last finished pass started at or after `time`: a
 * finished pass leaves its own start as the watermark. */
function laneReadSince(checkpoint: SoupBackfillCheckpoint, time: number) {
  if (checkpoint.completedAt === null || checkpoint.updatedSince === null)
    return false;
  const started = Date.parse(checkpoint.updatedSince);
  return Number.isFinite(started) && started >= time;
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
 * - A listed channel a by-id read found absent is out: the read answers for
 *   the record the cache holds now, which may be one it kept from before the
 *   viewer lost the channel.
 * - Otherwise a change the cache saw since is at least as new as the page
 *   that listed the channel.
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
  const { changes, confirmed } = evidence;
  const channels: DirectoryChannel[] = [];
  const listed = new Set<string>();
  for (const channel of network) {
    listed.add(channel.id);
    if (confirmed[channel.id] === 'absent') continue;
    const change = changes.get(channel.id);
    if (change === undefined) channels.push(channel);
    else if (change) channels.push(change);
  }
  for (const [id, change] of changes)
    if (change && !listed.has(id) && confirmed[id] === 'returned')
      channels.push(change);
  return channels;
}

/** The channels `fallbackChannels` decides by a by-id read: listed ones the
 * cache never held, changed ones the network did not list, and every one the
 * cache holds without every field (`incomplete`). What the walk or the cache
 * last showed of such a channel no longer holds: one joined after the walk
 * read its page, or rejoined after the viewer lost it (its record removed,
 * or kept as a nonmember's), can be cached first by a read without the
 * directory's fields, and only a by-id read lands it with them. */
export function fallbackConfirmations(
  network: readonly DirectoryChannel[],
  evidence: FallbackEvidence,
  incomplete: readonly string[] = []
): string[] {
  const { changes, seen } = evidence;
  const ids = new Set<string>();
  const listed = new Set<string>();
  for (const { id } of network) {
    listed.add(id);
    if (!seen.has(id) && !changes.has(id)) ids.add(id);
  }
  for (const [id, change] of changes)
    if (change && !listed.has(id)) ids.add(id);
  // No channel has an id no read can parse.
  for (const id of incomplete) if (isChannelId(id)) ids.add(id);
  return [...ids];
}

/** Whether the fallback's rows hold a channel a by-id read decides, by what
 * the read found: a listed one stays unless found absent, an unlisted one
 * shows once returned. */
function confirmedMembership(
  listed: boolean,
  outcome: ByIdOutcome | undefined
) {
  return listed ? outcome !== 'absent' : outcome === 'returned';
}

/** Whether an outcome that changed from `before` to `after` adds or
 * removes one of the fallback's rows. It may say so of one that does not. */
function membershipChanged(
  listed: ReadonlySet<string>,
  before: Readonly<Record<string, ByIdOutcome>>,
  after: Readonly<Record<string, ByIdOutcome>>
) {
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[id] === after[id]) continue;
    const isListed = listed.has(id);
    if (
      confirmedMembership(isListed, before[id]) !==
      confirmedMembership(isListed, after[id])
    )
      return true;
  }
  return false;
}

/** The ids no by-id read has decided yet. */
function undecided(
  ids: readonly string[],
  confirmed: Readonly<Record<string, ByIdOutcome>>
) {
  const open: Record<string, true> = {};
  for (const id of ids) {
    const outcome = confirmed[id];
    if (outcome !== 'returned' && outcome !== 'absent') open[id] = true;
  }
  return open;
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
  // Written only by `render`. One signal, not a store: the records hold
  // thousands of channels, which a store would wrap field by field.
  const [shown, setShown] = createSignal<ShownDirectory>({
    state: EMPTY_CHANNEL_DIRECTORY_STATE,
    fallback: 'idle',
    unconfirmed: NO_IDS,
  });
  const state = createMemo(() => shown().state);
  const views = createViewStamps();
  const view = createMemo(() => views.apply(state()));
  // Cached records older than a recorded view that the view was written
  // over again: a soup page read before the view can overwrite it.
  const restamped = new WeakSet<DirectoryChannel>();
  // Shown with the rows it gives once `render` runs.
  let fallback: LaneFallback = { status: 'idle' };
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
  // The lane as the read `lastRead` came from found it.
  let publishedLane = LANE_NOT_STARTED;
  const sessionStartedAt = deps.sessionStartedAt ?? performance.timeOrigin;
  // Written only by `render`, from the read shown.
  const [viewsCurrent, setViewsCurrent] = createSignal(false);
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
   * the read returned without a record `hasRecord` sees is unreadable; so,
   * when the read gave no evidence, is every id `vouches` cannot answer
   * for. */
  const readById = async (
    ids: string[],
    signal: AbortSignal,
    hasRecord: (id: string) => boolean,
    vouches: (id: string) => boolean = hasRecord
  ): Promise<ByIdRead> => {
    const page = await deps.hydrate(
      readableChannelsInput(CHANNEL_DIRECTORY_INPUT, ids),
      { signal }
    );
    const returned = returnedChannelIds(ids, page);
    // A lookup answers from the directory, so let it see the records the read
    // wrote first: those it returned, or without evidence any of them. One
    // that wrote none leaves the directory as it was.
    const written = returned ? [...returned] : ids;
    if (written.length > 0) {
      for (const id of written) wantKeys.add(`${CHANNEL_RECORD_PREFIX}${id}`);
      await runner();
    }
    // Without evidence, an id with no record may still be the viewer's.
    if (!returned)
      return {
        returned: undefined,
        unreadable: ids.filter((id) => !vouches(id)),
      };
    return {
      returned,
      unreadable: [...returned].filter((id) => !hasRecord(id)),
    };
  };
  const reader = createByIdReader(
    (ids, signal) =>
      readById(ids, signal, (id) => Boolean(untrack(state).records[id])),
    {
      version: (id) => index.version(id),
      // A read that wrote nothing published nothing that would queue more.
      onSettle: () => queueIncomplete(),
    }
  );
  // While the network's channels are shown: reads of those the cache cannot
  // vouch for. Their records land in the cache, so a returned channel reads
  // as the cache now holds it. A read without evidence decides none of them:
  // the cache can hold a record of a channel the viewer lost.
  const confirm = createByIdReader(
    (ids, signal) =>
      readById(
        ids,
        signal,
        (id) => index.record(id) !== undefined,
        () => false
      ),
    {
      version: (id) => index.version(id),
      onSettle: () => renderConfirmed(),
    }
  );
  // The channels the network fallback decides by a by-id read, as of the
  // last read of the cache.
  let confirmations: string[] | undefined;
  // The by-id outcomes the fallback's rows were last built from.
  let builtFrom: Readonly<Record<string, ByIdOutcome>> = {};
  // The ids of the network's rows, built once per load.
  let listed:
    | { rows: readonly DirectoryChannel[]; ids: Set<string> }
    | undefined;
  const listedIds = (rows: readonly DirectoryChannel[]) => {
    if (listed?.rows !== rows)
      listed = { rows, ids: new Set(rows.map(({ id }) => id)) };
    return listed.ids;
  };

  /** Publishes what `render` built with the fallback's status, keeping each
   * part that did not change. */
  const show = (
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>>
  ) => {
    const current = untrack(shown);
    const nextState = sameState(current.state, next) ? current.state : next;
    const nextUnconfirmed = sameIds(current.unconfirmed, unconfirmed)
      ? current.unconfirmed
      : unconfirmed;
    if (
      nextState === current.state &&
      nextUnconfirmed === current.unconfirmed &&
      current.fallback === fallback.status
    )
      return;
    setShown({
      state: nextState,
      fallback: fallback.status,
      unconfirmed: nextUnconfirmed,
    });
  };

  /** Shows the last read and, once the network's channels loaded, those
   * channels as the evidence since leaves them. A render after by-id reads
   * settled (`settle`) reuses the confirmations the last read chose, and
   * the rows too unless a read's outcome adds or removes one. */
  const render = (settle = false) => {
    setViewsCurrent(lastRead !== undefined && publishedLane.viewsCurrent);
    const network = fallback;
    if (network.status !== 'loaded') {
      show(
        lastRead
          ? channelDirectoryState(
              lastRead.channels,
              lastRead.incompleteIds,
              lane.complete
            )
          : EMPTY_CHANNEL_DIRECTORY_STATE,
        NO_IDS
      );
      return;
    }
    const confirmed = untrack(confirm.outcomes);
    // Nothing else changed since the last render: a read that failed, or
    // confirmed a row shown, leaves the rows as they are.
    if (
      settle &&
      confirmations &&
      !membershipChanged(listedIds(network.channels), builtFrom, confirmed)
    ) {
      show(untrack(shown).state, undecided(confirmations, confirmed));
      return;
    }
    builtFrom = confirmed;
    // Built while every row is walked anyway, so a settle walks none.
    listedIds(network.channels);
    const evidence: FallbackEvidence = {
      changes: changes ?? new Map(),
      seen: seen ?? new Set(),
      confirmed,
    };
    const next = channelDirectoryState(
      fallbackChannels(network.channels, evidence),
      lastRead?.incompleteIds ?? [],
      true
    );
    // Only this viewer's cache can show what the reads returned; without it
    // the network's pages are all there is to know.
    if (!settle || !confirmations)
      confirmations =
        generation === undefined
          ? []
          : fallbackConfirmations(
              network.channels,
              evidence,
              lastRead?.incompleteIds
            );
    show(next, undecided(confirmations, confirmed));
    if (settle) return;
    for (const id of confirmations) confirm.request(id);
  };
  const renderConfirmed = throttle(() => render(true), CONFIRM_RENDER_MS);

  /** Notes each record this read found changed or removed since the last,
   * while the fallback runs, and returns the ids of those removed. A record
   * that now lacks a field is not a change: what was seen of it stands, so
   * its removal later still is one. */
  const observe = (
    read: ChannelDirectoryRead,
    records: () => Map<string, DirectoryChannel>
  ): string[] => {
    if (!observed || !changes) return [];
    const removed: string[] = [];
    const next = records();
    for (const [id, channel] of next) {
      const before = observed.get(id);
      if (before !== channel && !deepEqual(before, channel))
        changes.set(id, channel);
    }
    const incomplete = new Set(read.incompleteIds);
    // Copied only when a record lost a field: `next` is shared.
    let kept: Map<string, DirectoryChannel> | undefined;
    for (const [id, before] of observed) {
      if (next.has(id)) continue;
      if (incomplete.has(id)) {
        kept ??= new Map(next);
        kept.set(id, before);
      } else {
        changes.set(id, null);
        removed.push(id);
      }
    }
    for (const id of next.keys()) seen?.add(id);
    observed = kept ?? next;
    return removed;
  };

  /** Stops showing the network's channels from the caller's next render. */
  const stopFallback = () => {
    if (fallback.status === 'idle') return;
    walk?.abort();
    walk = undefined;
    fallbackRun += 1;
    observed = undefined;
    changes = undefined;
    seen = undefined;
    confirmations = undefined;
    builtFrom = {};
    listed = undefined;
    confirm.reset();
    fallback = { status: 'idle' };
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

  /** A by-id read answered for the record the cache held then. One that
   * returned a channel whose record now lacks a field, or found absent a
   * channel whose record the cache changed since that read was sent (the
   * viewer may have joined it), proves nothing of the record now cached:
   * forget it, so the channel is read again. A channel a confirming read
   * returned is shown as the cache holds it, so a later write needs no read;
   * once the cache removes its record (`removed`) or holds it without a
   * field, that read proves nothing of the channel's record now, which a
   * rejoin may first write without a field. */
  const renewStaleReads = (
    read: ChannelDirectoryRead,
    removed: readonly string[]
  ) => {
    const outcomes = untrack(reader.outcomes);
    reader.renew(
      read.incompleteIds.filter((id) => outcomes[id] === 'returned')
    );
    reader.renewChanged();
    const confirmed = untrack(confirm.outcomes);
    confirm.renew([
      ...removed,
      ...read.incompleteIds.filter((id) => confirmed[id] === 'returned'),
    ]);
    confirm.renewChanged();
  };

  /** Queues by-id reads of the records that lack a field once the lane
   * finished; before that it fills them itself. At most
   * `INCOMPLETE_READS_PER_REFRESH` new ones at a time: ids already requested
   * do not count, so ones that keep failing cannot hold back the rest. */
  const queueIncomplete = () => {
    if (!lane.complete || !lastRead) return;
    let queued = 0;
    for (const id of lastRead.incompleteIds) {
      if (queued >= INCOMPLETE_READS_PER_REFRESH) break;
      if (reader.request(id)) queued += 1;
    }
  };

  const publish = (read: ChannelDirectoryRead) => {
    lastRead = read;
    publishedLane = lane;
    // Built once, and only when one of them needs it.
    let byId: Map<string, DirectoryChannel> | undefined;
    const records = () => {
      byId ??= recordsById(read);
      return byId;
    };
    const removed = observe(read, records);
    restampOlderRecords(records);
    // A finished pass reconciled the cache: it answers alone again.
    if (lane.complete) stopFallback();
    // `complete` reads both, so it never pairs one with the other's old value.
    batch(() => {
      renewStaleReads(read, removed);
      render();
    });
    queueIncomplete();
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
        const walk = await deps.pageAll(signal);
        if (signal.aborted || run !== fallbackRun) return;
        // The walk wrote its pages into the cache. Read them back first, once
        // written, so the cache holds every channel it can and a removal
        // reaches it; only the rest wait for a by-id read.
        const written = await settledWithin(
          walk.written,
          FALLBACK_PERSIST_WAIT_MS,
          signal
        );
        span.setAttr('channel_directory.fallback_pages', walk.pages);
        // -1 when the writes did not all settle in time.
        span.setAttr('channel_directory.fallback_pages_written', written ?? -1);
        if (signal.aborted || run !== fallbackRun) return;
        await refresh();
        if (signal.aborted || run !== fallbackRun) return;
        fallback = { status: 'loaded', channels: walk.channels };
        render();
      } catch (error) {
        if (signal.aborted || run !== fallbackRun) return;
        Telemetry.error(error, { surface: 'channel-directory-fallback' });
        fallback = { status: 'failed' };
        render();
      }
    });
  const startFallback = (reason: FallbackReason) => {
    if (fallback.status !== 'idle') return;
    fallbackRun += 1;
    // Changes from here on are at least as new as the pages it reads.
    observed = recordsById(lastRead);
    changes = new Map();
    seen = new Set(observed.keys());
    confirmations = undefined;
    confirm.reset();
    fallback = { status: 'loading' };
    render();
    walk?.abort();
    walk = new AbortController();
    // Never rejects: a failed read is reported inside.
    fireAndForget(
      loadFallback(fallbackRun, walk.signal, reason),
      'channel-directory-fallback'
    );
  };

  /** Pages the network again from what the cache holds now, when what the
   * fallback saw of the cache went away with its storage or its viewer. */
  const restartFallback = () => {
    if (fallback.status === 'idle') return;
    stopFallback();
    startFallback('scope_changed');
  };

  /** The cache's storage generation while it holds this viewer's records,
   * adopted as the directory's; undefined for another viewer's cache. */
  const adoptScope = async (signal: AbortSignal) => {
    const scope = await readContactCacheScope(host, userId, signal);
    // A lookup made before the first read keeps its by-id read.
    const changed = adopted !== undefined && adopted !== (scope ?? null);
    adopted = scope ?? null;
    generation = scope;
    if (changed)
      batch(() => {
        reader.reset();
        // What was read, and seen since, was of the cache in other hands.
        lastRead = undefined;
        restartFallback();
        render();
      });
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
      lane = readLaneProgress(userId, scope, sessionStartedAt);
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

  /** Rereads these records; false when a full read has to run instead. One
   * that finds every record as the index held it publishes nothing. */
  const readKeys = (keys: readonly string[]) =>
    Telemetry.span('channel_directory.read_keys', async (span) => {
      span.setAttr('channel_directory.keys', keys.length);
      const signal = controller.signal;
      const scope = await readContactCacheScope(host, userId, signal);
      if (scope === undefined || scope !== generation) return false;
      const found = await index.readKeys(scope, keys, signal);
      if (found.kind === 'stale') return false;
      span.setAttr('channel_directory.keys_changed', found.kind === 'read');
      if (found.kind === 'unchanged') return true;
      await assertContactCacheScope(host, userId, scope, signal);
      publish(found.read);
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
        adopted = undefined;
        batch(() => {
          // What a by-id read wrote into the old one is gone, and the
          // fallback saw the old one.
          reader.reset();
          restartFallback();
          render();
        });
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
      const next = readLaneProgress(userId, generation, sessionStartedAt);
      if (
        next.complete !== lane.complete ||
        next.failed !== lane.failed ||
        next.viewsCurrent !== lane.viewsCurrent
      )
        refreshNow();
    })
  );
  laneStalled();
  refreshNow();

  // A complete pass of the lane proves the records it wrote, not those it
  // did not: a joined channel another query cached without every field is
  // listed only once its by-id read lands it. The network's pages prove the
  // channels the cache vouches for, and by-id reads decide the rest.
  const proven = createMemo(() => {
    const { state: current, fallback: status, unconfirmed } = shown();
    if (!current.complete) return false;
    if (status === 'loaded') return Object.keys(unconfirmed).length === 0;
    const outcomes = reader.outcomes();
    for (const id of Object.keys(current.incomplete)) {
      // Never read: no channel has it.
      if (!isChannelId(id)) continue;
      const outcome = outcomes[id];
      if (outcome !== 'returned' && outcome !== 'absent') return false;
    }
    return true;
  });

  return {
    channels: () => view().joined,
    complete: proven,
    lookup(channelId) {
      const { unconfirmed } = shown();
      const result = lookupChannel(
        view(),
        reader.outcomes(),
        channelId,
        unconfirmed
      );
      // The fallback's own read decides an unconfirmed one.
      if (result.status === 'pending' && !unconfirmed[channelId])
        reader.request(channelId);
      return result;
    },
    async readComplete() {
      if (untrack(proven)) return untrack(view).joined;
      return inDirectoryOrder(views.applyList(await deps.fetchAll()));
    },
    failed: () => {
      const { state: current, fallback: status } = shown();
      return !current.complete && status === 'failed';
    },
    retry() {
      if (fallback.status !== 'failed') return;
      fallback = { status: 'idle' };
      startFallback('retry');
    },
    recordView(channelId, viewedAt) {
      if (views.record(channelId, viewedAt)) stampView(channelId, viewedAt);
    },
    viewsCurrent,
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
      return inDirectoryOrder(
        views.applyList(channels.filter(({ isParticipant }) => isParticipant))
      );
    },
    failed: () => pages.isError && !pages.isFetching,
    retry: () => fireAndForget(pages.refetch(), 'channel-directory'),
    recordView(channelId, viewedAt) {
      views.record(channelId, viewedAt);
    },
    viewsCurrent: () => true,
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
  viewsCurrent: () => true,
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
    viewsCurrent: () => true,
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
        const walk = await pageJoinedChannels(getGraphqlSoupClient(), signal);
        return {
          ...walk,
          channels: walk.channels.filter(({ isParticipant }) => isParticipant),
        };
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
    viewsCurrent: () => directory().viewsCurrent(),
  };
}
