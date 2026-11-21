import { sleep } from '@core/util/sleep';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import {
  type GraphqlChannelExpr,
  SoupChannelDirectoryBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInitialInput,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  hydrateGraphqlSoup,
} from '@service-storage/graphql-soup';
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
const NEVER_ABORTED = new AbortController().signal;

type FetchPage = (
  input: GraphqlSoupInput,
  options?: Pick<FetchGraphqlSoupOptions, 'signal'>
) => Promise<GraphqlSoupHydrationPage>;

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
 * a page is not complete evidence. */
async function unreadableChannels(
  lane: GraphqlSoupInitialInput,
  ids: readonly string[],
  fetch: FetchPage,
  signal: AbortSignal | undefined
): Promise<string[] | undefined> {
  // No channel has an id the server cannot parse, and naming one in a read
  // would fail it.
  const gone = ids.filter((id) => !isChannelId(id));
  for (const batch of chunks(ids.filter(isChannelId), BY_ID_BATCH)) {
    signal?.throwIfAborted();
    const page = await fetch(readableChannelsInput(lane, batch), { signal });
    const returned = returnedChannelIds(batch, page);
    if (!returned) return undefined;
    gone.push(...batch.filter((id) => !returned.has(id)));
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
  | 'complete';

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
 * A by-id read that found a channel gone is as of the moment it answered. A
 * record the cache rewrote since (the viewer was added back, and the update
 * landed before the delete) is read again instead of deleted. The check and
 * the delete are separate cache calls, so a write can land between them and
 * be deleted too: every deleted channel is read once more after its delete,
 * with the next round's reads, and one the viewer can read again is written
 * back by that read.
 */
async function removeUnreadableChannels(
  input: Reconciliation
): Promise<ReconcileOutcome> {
  return Telemetry.span('channel_directory.reconcile', async (span) => {
    span.setAttr('channel_directory.candidates', input.candidates.length);
    let pending = input.candidates;
    // Deleted in the last round, and not read since.
    let deleted: string[] = [];
    let removed = 0;
    let restored = 0;
    let round = 0;
    const finish = (outcome: ReconcileOutcome) => {
      span.setAttr('channel_directory.removed', removed);
      span.setAttr('channel_directory.restored', restored);
      span.setAttr('channel_directory.reconcile_rounds', round);
      span.setAttr('channel_directory.reconcile_outcome', outcome);
      return outcome;
    };
    while (pending.length > 0 || deleted.length > 0) {
      // Only channels still to decide count against the rounds: a read of
      // those already deleted decides nothing about the pass.
      if (pending.length > 0 && round === VERIFY_ROUNDS)
        return finish('unsettled');
      round += 1;
      // Taken before the evidence, so a removal it proves is refused once the
      // session it was read in has ended.
      const session = input.session();
      const before = await cachedHashes(input.host, pending, input.signal);
      // A channel no longer cached needs no read.
      const deciding = pending.filter((id) => before.has(id));
      const rereading = deleted;
      deleted = [];
      const gone = await unreadableChannels(
        input.lane,
        [...deciding, ...rereading],
        input.fetch,
        input.signal
      );
      if (!gone) {
        if (deciding.length > 0) return finish('incomplete');
        // The pass proved what it deleted; only this second look failed.
        span.setAttr('channel_directory.reread_failed', rereading.length);
        return finish('complete');
      }
      const goneIds = new Set(gone);
      restored += rereading.filter((id) => !goneIds.has(id)).length;
      const decided = deciding.filter((id) => goneIds.has(id));
      if (decided.length === 0) {
        pending = [];
        continue;
      }
      // Delete only for the viewer and storage the evidence was read for.
      if (!(await stillInScope(input))) return finish('scope_changed');
      const after = await cachedHashes(input.host, decided, input.signal);
      const stale = decided.filter((id) => after.get(id) === before.get(id));
      for (const batch of chunks(stale, DELETE_BATCH)) {
        input.signal?.throwIfAborted();
        await input.host.deleteRecords(
          batch.map((id) => `${CHANNEL_RECORD_PREFIX}${id}`),
          session
        );
      }
      removed += stale.length;
      deleted = stale;
      pending = decided.filter(
        (id) => after.has(id) && after.get(id) !== before.get(id)
      );
    }
    return finish('complete');
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
async function reconcile(input: Reconciliation): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await removeUnreadableChannels(input);
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
 * return is read again by id; the ones the server no longer returns are
 * deleted from the cache. A pass that cannot do so (it resumed from a cursor,
 * a page listed no ids, or the cache is another viewer's) deletes nothing; one
 * whose cache changed hands or whose reads kept failing stops before its next
 * round of deletes. Either fails on its last page, so the lane never records
 * it complete. Without a cache there is nothing to reconcile.
 *
 * A page counts once the lane asks for the page after it. The lane saves a
 * page's cursor only after the checks that follow its read, and a retry
 * reads from the cursor it saved, so a page whose checks failed is read
 * again and only that answer counts.
 */
export async function createChannelDirectoryBackfillFetcher(
  userId: string,
  host: ReconcileHost | undefined = getGraphqlSoupCacheHost(),
  fetch: FetchPage = fetchDirectoryPage,
  session: () => string = cacheSessionGeneration.capture
): Promise<FetchPage> {
  // Listed as the pass begins: a channel cached later by an event is not one
  // the pass could have missed.
  let scope = await readReconcileScope(host, userId);
  const seen = new Set<string>();
  let lane: GraphqlSoupInitialInput | undefined;
  let firstPage = true;
  let completeEvidence = true;
  let staged: StagedPage | undefined;

  return async (input, options) => {
    if (firstPage) {
      firstPage = false;
      // A resumed pass never saw the pages before its cursor.
      if (input.initial) lane = input.initial;
      else completeEvidence = false;
    }
    // Continuing from the staged page's cursor keeps it; any other read is
    // that page read again.
    if (staged && input.continuation?.cursor === staged.next) {
      for (const id of staged.ids) seen.add(id);
      if (!staged.evidence) completeEvidence = false;
    }
    staged = undefined;
    const page = await fetch(input, options);
    options?.signal?.throwIfAborted();
    const ids = page.entityIds ?? [];
    const evidence = page.entityIds !== undefined;
    if (page.nextCursor !== null) {
      staged = { next: page.nextCursor, ids, evidence };
      return page;
    }

    if (!host || host.disabled) return page;
    if (!completeEvidence || !evidence || !lane)
      throw new ChannelDirectoryPassUnproven('partial_pass');
    // The viewer's identity may have reached the cache only with this pass.
    scope ??= await readReconcileScope(host, userId);
    if (!scope) throw new ChannelDirectoryPassUnproven('scope');
    const last = new Set(ids);
    const candidates = scope.previous.filter(
      (id) => !seen.has(id) && !last.has(id)
    );
    if (candidates.length > 0)
      await reconcile({
        host: scope.host,
        userId,
        generation: scope.generation,
        lane,
        candidates,
        fetch,
        session,
        signal: options?.signal,
      });
    return page;
  };
}
