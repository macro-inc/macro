import { firstOrAborted } from '@core/util/abort-signal';
import { sleep } from '@core/util/sleep';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  ChannelDirectoryReconcileEntityDocument,
  type GraphqlChannelExpr,
  SoupChannelDirectoryBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInitialInput,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  hydrateGraphqlSoup,
} from '@service-storage/graphql-soup';
import { filter, pipe } from 'wonka';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from '../contacts/cache-scope';
import { balancedOr } from '../soup/graphql/entity-input';
import { isChannelId } from './channel-id';
import {
  CHANNEL_RECORD_PREFIX,
  listCachedChannelDocuments,
} from './directory-cache';
import {
  addChannelRereads,
  pendingChannelRereads,
  settleChannelRereads,
} from './directory-rereads';

// The server answers a by-id read of at most this many channels in one page.
const BY_ID_BATCH = 100;
const DELETE_BATCH = 500;
// A failed reconciliation is tried again this many times, this far apart,
// before the pass fails: failing it pages the whole lane again.
const RECONCILE_ATTEMPTS = 3;
const RECONCILE_RETRY_MS = 1_000;
// A channel the cache rewrote after a by-id read found it gone is read again,
// in at most this many rounds in all, before the pass gives up on it.
const VERIFY_ROUNDS = 3;
// Channels read from the primary at once, one read each.
const PRIMARY_READ_CONCURRENCY = 4;
// At most this many channels the replica no longer returned are confirmed on
// the primary in one pass. The rest wait for the next pass, which this one
// fails, so a replica that answers with nothing cannot send the whole cache
// to the primary, and a larger removal still finishes over several passes.
const PRIMARY_CONFIRM_LIMIT = 500;
const NEVER_ABORTED = new AbortController().signal;

type FetchPage = (
  input: GraphqlSoupInput,
  options?: Pick<FetchGraphqlSoupOptions, 'signal'>
) => Promise<GraphqlSoupHydrationPage>;

/** Whether the primary database shows the viewer the channel. A readable
 * channel is written back to the cache by the read. Throws when the read
 * fails. */
type ReadFromPrimary = (
  channelId: string,
  signal: AbortSignal | undefined
) => Promise<'readable' | 'unreadable'>;

type ReconcileHost = Pick<
  CacheHost,
  | 'search'
  | 'readRecordsByKeys'
  | 'readQuery'
  | 'currentStorageGeneration'
  | 'deleteRecords'
  | 'disabled'
>;

const fetchDirectoryPage: FetchPage = (input, options) =>
  hydrateGraphqlSoup(SoupChannelDirectoryBackfillDocument, { input }, options);

const readChannelOnPrimary: ReadFromPrimary = async (channelId, signal) => {
  // An abort leaves the query's result source, which is what ends urql's
  // request: urql replaces a `fetchOptions.signal` with its own.
  const settled = await firstOrAborted(
    pipe(
      getGraphqlSoupClient().query(
        ChannelDirectoryReconcileEntityDocument,
        { input: { entityType: 'CHANNEL', entityId: channelId } },
        { requestPolicy: 'network-only' }
      ),
      // The answer, as urql's own toPromise takes it.
      filter((result) => !result.stale && !result.hasNext)
    ),
    signal
  );
  if (settled.kind === 'aborted') {
    signal?.throwIfAborted();
    throw new Error('primary channel read was cancelled');
  }
  if (settled.kind === 'ended')
    throw new Error('primary channel read ended without an answer');
  const result = settled.value;
  if (result.error) throw result.error;
  if (!result.data) throw new Error('primary channel read returned no data');
  if (result.data.user.soupEntity?.__typename !== 'GraphqlSoupChannel')
    return 'unreadable';
  // Readable means written back: the caller may complete the pass, or drop
  // the reread it owed, only once the cache holds the channel again.
  const metadata = normalizedCacheResultMetadata(result);
  if (
    metadata?.source === 'live-network' &&
    (await metadata.persistence) === undefined
  )
    throw new Error('primary channel read was not written to the cache');
  return 'readable';
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    result.push(items.slice(offset, offset + size));
  return result;
}

/**
 * The channels named by `ids` that the viewer can still read: joined ones,
 * and public or team channels they have not joined. This is the server's
 * by-id rule, which a filter naming only channel ids and both
 * participation states selects.
 */
export function readableChannelsInput(
  lane: GraphqlSoupInitialInput,
  ids: readonly string[]
): GraphqlSoupInput {
  const named = balancedOr<GraphqlChannelExpr>(
    ids.map((channelId) => ({ literal: { channelId } }))
  );
  const eitherParticipation: GraphqlChannelExpr = {
    or: {
      left: { literal: { isParticipant: true } },
      right: { literal: { isParticipant: false } },
    },
  };
  return {
    initial: {
      ...lane,
      limit: ids.length,
      filters: {
        ...lane.filters,
        channelFilter: named
          ? { and: { left: named, right: eitherParticipation } }
          : eitherParticipation,
      },
    },
  };
}

/**
 * The ids a by-id read of `requested` returned, or undefined when its page is
 * not complete evidence of which the viewer can read. The server puts a
 * cursor on every page that reaches its limit, so a page that returned every
 * requested id is complete even with one.
 */
export function returnedChannelIds(
  requested: readonly string[],
  page: GraphqlSoupHydrationPage
): Set<string> | undefined {
  if (!page.entityIds) return undefined;
  const returned = new Set(page.entityIds);
  if (page.nextCursor !== null && !requested.every((id) => returned.has(id)))
    return undefined;
  return returned;
}

/** Which of `ids` the server no longer returns to the viewer. Undefined when
 * a page is not complete evidence. Each read is sent in `trace`: a batch
 * after the first starts past an await. */
async function unreadableChannels(
  lane: GraphqlSoupInitialInput,
  ids: readonly string[],
  fetch: FetchPage,
  signal: AbortSignal | undefined,
  trace: TraceContext
): Promise<string[] | undefined> {
  // No channel has an id the server cannot parse, and naming one in a read
  // would fail it.
  const gone = ids.filter((id) => !isChannelId(id));
  for (const batch of chunks(ids.filter(isChannelId), BY_ID_BATCH)) {
    signal?.throwIfAborted();
    const page = await trace.run(() =>
      fetch(readableChannelsInput(lane, batch), { signal })
    );
    const returned = returnedChannelIds(batch, page);
    if (!returned) return undefined;
    gone.push(...batch.filter((id) => !returned.has(id)));
  }
  return gone;
}

/** Which of `ids` the primary shows the viewer can no longer read, a few
 * reads at a time, each sent in `trace`. A failed read throws. */
async function unreadableOnPrimary(
  ids: readonly string[],
  read: ReadFromPrimary,
  signal: AbortSignal | undefined,
  trace: TraceContext
): Promise<Set<string>> {
  // An id the server cannot parse names no channel anyone can read.
  const gone = new Set(ids.filter((id) => !isChannelId(id)));
  for (const batch of chunks(
    ids.filter(isChannelId),
    PRIMARY_READ_CONCURRENCY
  )) {
    signal?.throwIfAborted();
    const answers = await trace.run(() =>
      Promise.all(batch.map((id) => read(id, signal)))
    );
    batch.forEach((id, index) => {
      if (answers[index] === 'unreadable') gone.add(id);
    });
  }
  return gone;
}

type Reconciliation = {
  host: ReconcileHost;
  userId: string;
  generation: string;
  lane: GraphqlSoupInitialInput;
  candidates: readonly string[];
  fetch: FetchPage;
  readFromPrimary: ReadFromPrimary;
  /** The cache session a removal is made in; the cache refuses a removal
   * made in a session that has since ended. */
  session: () => string;
  signal: AbortSignal | undefined;
};

/** Whether the cache still belongs to the viewer and storage generation the
 * evidence was read for. */
async function stillInScope(input: Reconciliation): Promise<boolean> {
  try {
    await assertContactCacheScope(
      input.host,
      input.userId,
      input.generation,
      input.signal ?? NEVER_ABORTED
    );
    return true;
  } catch (error) {
    if (error instanceof ContactDirectoryScopeError) return false;
    throw error;
  }
}

type ReconcileOutcome =
  | 'incomplete'
  | 'scope_changed'
  | 'unsettled'
  | 'deferred'
  // Storage refused the second look a delete owes, so nothing was deleted.
  | 'unsaved'
  | 'complete';

/** What reconciliation carries past a failed attempt. The channels it
 * deleted and owes a second look are kept in `directory-rereads`, past the
 * fetcher. */
type ReconcileProgress = {
  /** Channels confirmed on the primary in this reconciliation, against
   * `PRIMARY_CONFIRM_LIMIT`. */
  confirmed: number;
};

type RereadInput = Pick<
  Reconciliation,
  'userId' | 'generation' | 'readFromPrimary' | 'signal'
>;

/** Reads on the primary each channel a delete in this storage generation
 * owes a second look, which writes back the ones the viewer can read again,
 * then drops them from the store. Returns how many were written back. A
 * failed read throws and keeps every one owed. */
async function settleRereads(
  input: RereadInput,
  trace: TraceContext
): Promise<number> {
  const owed = pendingChannelRereads(input.userId, input.generation);
  if (owed.length === 0) return 0;
  const gone = await unreadableOnPrimary(
    owed,
    input.readFromPrimary,
    input.signal,
    trace
  );
  settleChannelRereads(input.userId, input.generation, owed);
  return owed.filter((id) => !gone.has(id)).length;
}

/** `settleRereads` in its own span, for a fetcher outside reconciliation. */
function settleRereadsTraced(input: RereadInput): Promise<number> {
  return Telemetry.span('channel_directory.reread', async (span) => {
    const restored = await settleRereads(input, span);
    span.setAttr('channel_directory.restored', restored);
    return restored;
  });
}

/** The search source hash of each of `ids` the cache holds a record of. */
async function cachedHashes(
  host: ReconcileHost,
  ids: readonly string[],
  signal: AbortSignal | undefined
): Promise<Map<string, string>> {
  const wanted = new Set(ids.map((id) => `${CHANNEL_RECORD_PREFIX}${id}`));
  const hashes = new Map<string, string>();
  for (const { recordKey, sourceHash } of await listCachedChannelDocuments(
    host,
    signal
  ))
    if (wanted.has(recordKey))
      hashes.set(recordKey.slice(CHANNEL_RECORD_PREFIX.length), sourceHash);
  return hashes;
}

/**
 * Deletes the cached channels the viewer can no longer read: channels they
 * were removed from or that were deleted while no event reached them.
 *
 * A by-id read of the replica decides which candidates are still readable,
 * a hundred at a time. The replica can lag an update the cache already holds
 * (the viewer was added back, and the cache read that from the primary), so
 * each channel it no longer returns is read on the primary before it is
 * deleted, and one the primary shows is kept and written back.
 *
 * A read that found a channel gone is as of the moment it answered. A record
 * the cache rewrote since is read again instead of deleted. The check and the
 * delete are separate cache calls, so a write can land between them and be
 * deleted too: every deleted channel is read on the primary once more after
 * its delete, and one the viewer can read again is written back by that
 * read. A failed read fails the attempt, and the next attempt starts with
 * that second look. It is owed in localStorage before the delete; when
 * storage refuses it, nothing is deleted and the pass stays unproven.
 */
async function removeUnreadableChannels(
  input: Reconciliation,
  progress: ReconcileProgress
): Promise<ReconcileOutcome> {
  return Telemetry.span('channel_directory.reconcile', async (span) => {
    span.setAttr('channel_directory.candidates', input.candidates.length);
    let pending = input.candidates;
    let removed = 0;
    let restored = 0;
    // The replica no longer returned them; the primary did.
    let kept = 0;
    let deferred = 0;
    let round = 0;
    const finish = (outcome: ReconcileOutcome) => {
      span.setAttr('channel_directory.removed', removed);
      span.setAttr('channel_directory.restored', restored);
      span.setAttr('channel_directory.kept_by_primary', kept);
      span.setAttr('channel_directory.deferred', deferred);
      span.setAttr('channel_directory.primary_confirmed', progress.confirmed);
      span.setAttr('channel_directory.reconcile_rounds', round);
      span.setAttr('channel_directory.reconcile_outcome', outcome);
      return outcome;
    };
    for (;;) {
      // The second look at what the last round (or a failed attempt, or an
      // earlier pass) deleted comes first, so no later outcome skips it.
      restored += await settleRereads(input, span);
      if (pending.length === 0) break;
      if (round === VERIFY_ROUNDS) return finish('unsettled');
      round += 1;
      // Taken before the evidence, so a removal it proves is refused once the
      // session it was read in has ended.
      const session = input.session();
      const before = await span.run(() =>
        cachedHashes(input.host, pending, input.signal)
      );
      // A channel no longer cached needs no read.
      const deciding = pending.filter((id) => before.has(id));
      const replicaGone = await unreadableChannels(
        input.lane,
        deciding,
        input.fetch,
        input.signal,
        span
      );
      if (!replicaGone) return finish('incomplete');
      const room = Math.max(0, PRIMARY_CONFIRM_LIMIT - progress.confirmed);
      const confirming = replicaGone.slice(0, room);
      deferred += replicaGone.length - confirming.length;
      const primaryGone = await unreadableOnPrimary(
        confirming,
        input.readFromPrimary,
        input.signal,
        span
      );
      progress.confirmed += confirming.length;
      kept += confirming.filter((id) => !primaryGone.has(id)).length;
      const decided = confirming.filter((id) => primaryGone.has(id));
      if (decided.length === 0) {
        pending = [];
        continue;
      }
      // Delete only for the viewer and storage the evidence was read for.
      if (!(await span.run(() => stillInScope(input))))
        return finish('scope_changed');
      const after = await span.run(() =>
        cachedHashes(input.host, decided, input.signal)
      );
      const stale = decided.filter((id) => after.get(id) === before.get(id));
      for (const batch of chunks(stale, DELETE_BATCH)) {
        input.signal?.throwIfAborted();
        const keys = batch.map((id) => `${CHANNEL_RECORD_PREFIX}${id}`);
        // Owed before the delete, so a pass that stops after it still reads
        // them again. Storage that refuses them would leave a channel the
        // viewer was added back to deleted for good, so the pass stops
        // unproven and the directory reads the network instead.
        if (!addChannelRereads(input.userId, input.generation, batch))
          return finish('unsaved');
        await span.run(() => input.host.deleteRecords(keys, session));
      }
      removed += stale.length;
      pending = decided.filter(
        (id) => after.has(id) && after.get(id) !== before.get(id)
      );
    }
    return finish(deferred > 0 ? 'deferred' : 'complete');
  });
}

type ReconcileScope = {
  host: ReconcileHost;
  generation: string;
  /** Ids of the channels cached when the pass began. */
  previous: string[];
};

/** The viewer's cache as the pass begins, or undefined when this pass cannot
 * reconcile: no cache, another viewer's, or a failed read. */
async function readReconcileScope(
  host: ReconcileHost | undefined,
  userId: string
): Promise<ReconcileScope | undefined> {
  if (!host || host.disabled) return undefined;
  try {
    const generation = await readContactCacheScope(host, userId, NEVER_ABORTED);
    if (generation === undefined) return undefined;
    const documents = await listCachedChannelDocuments(host);
    return {
      host,
      generation,
      previous: documents.map(({ recordKey }) =>
        recordKey.slice(CHANNEL_RECORD_PREFIX.length)
      ),
    };
  } catch (error) {
    // The lane still runs; it only skips reconciling this pass.
    Telemetry.error(error, { surface: 'channel-directory-reconcile' });
    return undefined;
  }
}

/** A pass whose last page landed but that could not prove which cached
 * channels are stale. Failing its last page keeps the lane from recording the
 * pass as complete, which the directory reads as the cache holding exactly
 * the viewer's channels. */
export class ChannelDirectoryPassUnproven extends Error {
  constructor(readonly reason: 'partial_pass' | 'scope' | ReconcileOutcome) {
    super(`channel directory pass could not reconcile the cache: ${reason}`);
  }
}

/** A page the lane read and has not yet kept: its channel ids, whether it
 * listed them, and the cursor the lane continues from once it keeps it. */
type StagedPage = {
  next: string;
  ids: readonly string[];
  evidence: boolean;
};

/** Reconciles, again after a failed read, until the cache is proven. */
async function reconcile(
  input: Reconciliation,
  progress: ReconcileProgress
): Promise<void> {
  progress.confirmed = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await removeUnreadableChannels(input, progress);
      if (outcome === 'complete') return;
      throw new ChannelDirectoryPassUnproven(outcome);
    } catch (error) {
      input.signal?.throwIfAborted();
      if (
        error instanceof ChannelDirectoryPassUnproven ||
        attempt >= RECONCILE_ATTEMPTS
      )
        throw error;
      Telemetry.error(error, { surface: 'channel-directory-reconcile' });
      await sleep(RECONCILE_RETRY_MS * attempt);
    }
  }
}

/**
 * Page fetcher for the channel backfill lane that also removes what the lane
 * proves stale. The lane lists every channel the viewer joined. When a pass
 * that started at its first page finishes, each cached channel it did not
 * return is read again by id; the ones neither the replica nor the primary
 * returns are deleted from the cache. A pass that cannot do so (it resumed
 * from a cursor, a page listed no ids, or the cache is another viewer's)
 * deletes nothing; one whose cache changed hands or whose reads kept failing
 * stops before its next round of deletes, and one with more channels to
 * confirm than `PRIMARY_CONFIRM_LIMIT` leaves the rest to the next pass.
 * Each fails on its last page, so the lane never records it complete.
 * Without a cache there is nothing to reconcile.
 *
 * A page counts once the lane asks for the page after it. The lane saves a
 * page's cursor only after the checks that follow its read, and a retry
 * reads from the cursor it saved, so a page whose checks failed is read
 * again and only that answer counts. The channels a delete owes a second
 * look (`directory-rereads`) are read on the primary before the first page
 * and again before the last one decides anything, whichever fetcher, pass or
 * tab made the delete, and even when this pass cannot reconcile.
 */
export async function createChannelDirectoryBackfillFetcher(
  userId: string,
  host: ReconcileHost | undefined = getGraphqlSoupCacheHost(),
  fetch: FetchPage = fetchDirectoryPage,
  session: () => string = cacheSessionGeneration.capture,
  readFromPrimary: ReadFromPrimary = readChannelOnPrimary
): Promise<FetchPage> {
  // Listed as the pass begins: a channel cached later by an event is not one
  // the pass could have missed.
  let scope = await readReconcileScope(host, userId);
  const seen = new Set<string>();
  let lane: GraphqlSoupInitialInput | undefined;
  let firstPage = true;
  let completeEvidence = true;
  let staged: StagedPage | undefined;
  const progress: ReconcileProgress = { confirmed: 0 };
  const rereadOwed = (signal: AbortSignal | undefined) =>
    scope
      ? settleRereadsTraced({
          userId,
          generation: scope.generation,
          readFromPrimary,
          signal,
        })
      : Promise.resolve(0);

  return async (input, options) => {
    // A delete an earlier pass, fetcher or tab made and never read again is
    // read now: the cache no longer holds it, so this pass cannot find it. A
    // failed read fails the page, which is read again.
    const starting = firstPage;
    if (starting) await rereadOwed(options?.signal);
    // Continuing from the staged page's cursor keeps it; any other read is
    // that page read again.
    if (staged && input.continuation?.cursor === staged.next) {
      for (const id of staged.ids) seen.add(id);
      if (!staged.evidence) completeEvidence = false;
    }
    staged = undefined;
    const page = await fetch(input, options);
    options?.signal?.throwIfAborted();
    // The pass starts with the first page it read, so a first read that
    // failed decides nothing about the next one.
    if (starting) {
      firstPage = false;
      // A resumed pass never saw the pages before its cursor.
      if (input.initial) lane = input.initial;
      else completeEvidence = false;
    }
    const ids = page.entityIds ?? [];
    const evidence = page.entityIds !== undefined;
    if (page.nextCursor !== null) {
      staged = { next: page.nextCursor, ids, evidence };
      return page;
    }

    if (!host || host.disabled) return page;
    // The viewer's identity may have reached the cache only with this pass.
    scope ??= await readReconcileScope(host, userId);
    // Owed whether or not this pass can reconcile.
    await rereadOwed(options?.signal);
    if (!completeEvidence || !evidence || !lane)
      throw new ChannelDirectoryPassUnproven('partial_pass');
    if (!scope) throw new ChannelDirectoryPassUnproven('scope');
    const last = new Set(ids);
    const candidates = scope.previous.filter(
      (id) => !seen.has(id) && !last.has(id)
    );
    if (candidates.length > 0)
      await reconcile(
        {
          host: scope.host,
          userId,
          generation: scope.generation,
          lane,
          candidates,
          fetch,
          readFromPrimary,
          session,
          signal: options?.signal,
        },
        progress
      );
    return page;
  };
}
