import { fireAndForget } from '@core/util/fireAndForget';
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
import {
  CHANNEL_RECORD_PREFIX,
  listCachedChannelDocuments,
} from './directory-cache';
import {
  type ShadowScope,
  shadowCompareChannelDirectory,
} from './directory-shadow';

// The server answers a by-id read of at most this many channels in one page.
const BY_ID_BATCH = 100;
const DELETE_BATCH = 500;
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
function readableChannelsInput(
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

/** Which of `ids` the server no longer returns to the viewer. Undefined when
 * a page is not complete evidence. */
async function unreadableChannels(
  lane: GraphqlSoupInitialInput,
  ids: readonly string[],
  fetch: FetchPage,
  signal: AbortSignal | undefined
): Promise<string[] | undefined> {
  const gone: string[] = [];
  for (const batch of chunks(ids, BY_ID_BATCH)) {
    signal?.throwIfAborted();
    const page = await fetch(readableChannelsInput(lane, batch), { signal });
    if (page.nextCursor !== null || !page.entityIds) return undefined;
    const returned = new Set(page.entityIds);
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
 * the delete are separate cache calls, so a write that lands between them is
 * still deleted; it comes back with the channel's next update or lane pass.
 */
async function removeUnreadableChannels(
  input: Reconciliation
): Promise<ReconcileOutcome> {
  return Telemetry.span('channel_directory.reconcile', async (span) => {
    span.setAttr('channel_directory.candidates', input.candidates.length);
    let pending = input.candidates;
    let removed = 0;
    let round = 0;
    const finish = (outcome: ReconcileOutcome) => {
      span.setAttr('channel_directory.removed', removed);
      span.setAttr('channel_directory.reconcile_rounds', round);
      span.setAttr('channel_directory.reconcile_outcome', outcome);
      return outcome;
    };
    while (pending.length > 0) {
      if (round === VERIFY_ROUNDS) return finish('unsettled');
      round += 1;
      // Taken before the evidence, so a removal it proves is refused once the
      // session it was read in has ended.
      const session = input.session();
      const before = await cachedHashes(input.host, pending, input.signal);
      const gone = await unreadableChannels(
        input.lane,
        // A channel no longer cached needs no read.
        pending.filter((id) => before.has(id)),
        input.fetch,
        input.signal
      );
      if (!gone) return finish('incomplete');
      // Delete only for the viewer and storage the evidence was read for.
      if (!(await stillInScope(input))) return finish('scope_changed');
      const after = await cachedHashes(input.host, gone, input.signal);
      const stale = gone.filter((id) => after.get(id) === before.get(id));
      for (const batch of chunks(stale, DELETE_BATCH)) {
        input.signal?.throwIfAborted();
        await input.host.deleteRecords(
          batch.map((id) => `${CHANNEL_RECORD_PREFIX}${id}`),
          session
        );
      }
      removed += stale.length;
      pending = gone.filter(
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

/**
 * Page fetcher for the channel backfill lane that also removes what the lane
 * proves stale. The lane lists every channel the viewer joined. When a pass
 * that started at its first page finishes, each cached channel it did not
 * return is read again by id; the ones the server no longer returns are
 * deleted from the cache, under the cache session the evidence was read in.
 * A resumed, failed or cancelled pass, or a cache that belongs to another
 * viewer, deletes nothing.
 *
 * Once a pass has been reconciled, `onReconciled` compares the cache with
 * the REST channel list in the background (the shadow comparison).
 */
export async function createChannelDirectoryBackfillFetcher(
  userId: string,
  host: ReconcileHost | undefined = getGraphqlSoupCacheHost(),
  fetch: FetchPage = fetchDirectoryPage,
  onReconciled: (
    scope: ShadowScope
  ) => Promise<void> = shadowCompareChannelDirectory,
  session: () => string = cacheSessionGeneration.capture
): Promise<FetchPage> {
  const scope = await readReconcileScope(host, userId);
  const seen = new Set<string>();
  let lane: GraphqlSoupInitialInput | undefined;
  let firstPage = true;
  let completeEvidence = true;

  return async (input, options) => {
    if (firstPage) {
      firstPage = false;
      // A resumed pass never saw the pages before its cursor.
      if (input.initial) lane = input.initial;
      else completeEvidence = false;
    }
    const page = await fetch(input, options);
    options?.signal?.throwIfAborted();
    if (!page.entityIds) completeEvidence = false;
    for (const id of page.entityIds ?? []) seen.add(id);

    if (page.nextCursor === null && completeEvidence && lane && scope) {
      const candidates = scope.previous.filter((id) => !seen.has(id));
      let outcome: ReconcileOutcome | 'failed' = 'complete';
      if (candidates.length > 0) {
        try {
          outcome = await removeUnreadableChannels({
            host: scope.host,
            userId,
            generation: scope.generation,
            lane,
            candidates,
            fetch,
            session,
            signal: options?.signal,
          });
        } catch (error) {
          options?.signal?.throwIfAborted();
          // Stale records stay until the next pass; the page itself landed.
          Telemetry.error(error, { surface: 'channel-directory-reconcile' });
          outcome = 'failed';
        }
      }
      // Compare only a cache the pass both filled and cleaned, without
      // holding the page back for it.
      if (outcome === 'complete')
        fireAndForget(
          onReconciled({
            host: scope.host,
            userId,
            generation: scope.generation,
          }),
          'channel-directory-shadow'
        );
    }
    return page;
  };
}
