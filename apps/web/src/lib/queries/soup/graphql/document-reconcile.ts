import { firstOrAborted } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { readRecordsByKeys, selectRecords } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import {
  DocumentReconcileEntityDocument,
  DocumentReconcileEntityFullDocument,
  GraphqlDocumentQuickAccessNameFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { filter, pipe } from 'wonka';

export const DOCUMENT_RECORD_PREFIX = 'GraphqlSoupDocument:';
/** Documents read from the primary at once, one read each. */
const PRIMARY_READ_CONCURRENCY = 3;
/** A document checked this recently is not checked again by one verifier. */
const VERIFY_TTL_MS = 5 * 60_000;
const DOCUMENT_SELECTION = selectRecords(
  GraphqlDocumentQuickAccessNameFragmentDoc
);

/** Which fields a primary read writes back: the name fields local search
 * reads, or the whole Soup item lists read. */
export type DocumentReadSelection = 'name' | 'full';

/** Whether the primary database shows the viewer the document. A readable
 * document is written back to the cache by the read, so its cached `selection`
 * fields are current again. Throws when the read fails. */
export type ReadDocumentFromPrimary = (
  documentId: string,
  signal: AbortSignal | undefined,
  selection: DocumentReadSelection
) => Promise<'readable' | 'gone'>;

export type DocumentReconcileHost = Pick<
  CacheHost,
  'readRecordsByKeys' | 'deleteRecords' | 'disabled'
>;

const readDocumentOnPrimary: ReadDocumentFromPrimary = async (
  documentId,
  signal,
  selection
) => {
  // An abort leaves the query's result source, which is what ends urql's
  // request: urql replaces a `fetchOptions.signal` with its own.
  const settled = await firstOrAborted(
    pipe(
      getGraphqlSoupClient().query(
        selection === 'full'
          ? DocumentReconcileEntityFullDocument
          : DocumentReconcileEntityDocument,
        { input: { entityType: 'DOCUMENT', entityId: documentId } },
        { requestPolicy: 'network-only' }
      ),
      filter((result) => !result.stale && !result.hasNext)
    ),
    signal
  );
  if (settled.kind === 'aborted') {
    signal?.throwIfAborted();
    throw new Error('primary document read was cancelled');
  }
  if (settled.kind === 'ended')
    throw new Error('primary document read ended without an answer');
  const result = settled.value;
  if (result.error) throw result.error;
  if (!result.data) throw new Error('primary document read returned no data');
  // Null for a document in the Trash, deleted, or no longer shared with the
  // viewer: the Soup gates every list applies.
  if (!result.data.user.soupEntity) return 'gone';
  // Readable means written back, so a reread after a delete restores it.
  const metadata = normalizedCacheResultMetadata(result);
  if (
    metadata?.source === 'live-network' &&
    (await metadata.persistence) === undefined
  )
    throw new Error('primary document read was not written to the cache');
  return 'readable';
};

/** A fingerprint of each cached, settled document record in `ids`. A record
 * with a pending local write (a restore the viewer just made) is left out,
 * so it is never deleted. */
async function cachedFingerprints(
  host: DocumentReconcileHost,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const { records } = await readRecordsByKeys(
    host,
    DOCUMENT_SELECTION,
    ids.map((id) => `${DOCUMENT_RECORD_PREFIX}${id}`)
  );
  const fingerprints = new Map<string, string>();
  for (const { recordKey, record, identity } of records) {
    if (identity?.pending) continue;
    if (!recordKey.startsWith(DOCUMENT_RECORD_PREFIX)) continue;
    fingerprints.set(
      recordKey.slice(DOCUMENT_RECORD_PREFIX.length),
      JSON.stringify(record)
    );
  }
  return fingerprints;
}

/** Which of `ids` the primary no longer shows the viewer, a few reads at a
 * time, each sent in `trace`. A failed read throws. */
async function goneOnPrimary(
  ids: readonly string[],
  read: ReadDocumentFromPrimary,
  signal: AbortSignal | undefined,
  selection: DocumentReadSelection,
  trace: TraceContext
): Promise<Set<string>> {
  const gone = new Set<string>();
  for (
    let offset = 0;
    offset < ids.length;
    offset += PRIMARY_READ_CONCURRENCY
  ) {
    signal?.throwIfAborted();
    const batch = ids.slice(offset, offset + PRIMARY_READ_CONCURRENCY);
    const answers = await trace.run(() =>
      Promise.all(batch.map((id) => read(id, signal, selection)))
    );
    batch.forEach((id, index) => {
      if (answers[index] === 'gone') gone.add(id);
    });
  }
  return gone;
}

export type RemoveGoneDocumentsInput = {
  host: DocumentReconcileHost;
  ids: readonly string[];
  readFromPrimary?: ReadDocumentFromPrimary;
  /** The cache session a removal is made in; the cache refuses a removal
   * made in a session that has since ended. */
  session?: () => string;
  signal?: AbortSignal;
};

export type RemoveGoneDocumentsOutcome =
  | 'not_cached'
  | 'readable'
  | 'rewritten'
  | 'removed'
  | 'removed_unconfirmed';

export type RemoveGoneDocumentsResult = {
  /** Documents whose cached records were deleted. */
  removed: string[];
  outcome: RemoveGoneDocumentsOutcome;
};

/**
 * Deletes the cached records of `ids` that the primary no longer shows the
 * viewer: documents moved to the Trash, deleted, or unshared while no
 * realtime patch reached this client. Realtime deletions go only to live
 * subscribers and are never replayed, so a client that was closed, asleep or
 * reconnecting keeps the old record, and local search keeps matching it.
 *
 * Each document is read on the primary by id, which writes a readable one
 * back (refreshing a stale name). A record the cache rewrote between the two
 * looks at it is kept. The cache has no compare-and-delete, so a write can
 * land between the second look and the delete: each deleted document is
 * read on the primary once more, which writes back one the viewer can read
 * again. A failed read before the delete throws and deletes nothing.
 */
export async function removeDocumentsGoneOnPrimary(
  input: RemoveGoneDocumentsInput
): Promise<RemoveGoneDocumentsResult> {
  const read = input.readFromPrimary ?? readDocumentOnPrimary;
  const sessionOf = input.session ?? cacheSessionGeneration.capture;
  return Telemetry.span('soup.documents.remove_gone', async (span) => {
    try {
      return await removeGone(input, read, sessionOf, span);
    } catch (error) {
      span.setAttr(
        'soup.documents.remove_gone_outcome',
        input.signal?.aborted ? 'cancelled' : 'failed'
      );
      span.error(error);
      throw error;
    }
  });
}

async function removeGone(
  input: RemoveGoneDocumentsInput,
  read: ReadDocumentFromPrimary,
  sessionOf: () => string,
  span: Span
): Promise<RemoveGoneDocumentsResult> {
  span.setAttr('soup.documents.candidates', input.ids.length);
  span.setAttr('soup.documents.ids', input.ids.join(','));
  const finish = (
    removed: readonly string[],
    outcome: RemoveGoneDocumentsOutcome,
    gone = 0
  ): RemoveGoneDocumentsResult => {
    span.setAttr('soup.documents.gone', gone);
    span.setAttr('soup.documents.removed', removed.length);
    span.setAttr('soup.documents.remove_gone_outcome', outcome);
    return { removed: [...removed], outcome };
  };
  // Taken before the evidence, so the cache refuses the delete once the
  // session it was read in has ended.
  const session = sessionOf();
  const before = await span.run(() =>
    cachedFingerprints(input.host, input.ids)
  );
  const cached = input.ids.filter((id) => before.has(id));
  if (cached.length === 0) return finish([], 'not_cached');
  const gone = await goneOnPrimary(cached, read, input.signal, 'name', span);
  const decided = cached.filter((id) => gone.has(id));
  if (decided.length === 0) return finish([], 'readable');
  const after = await span.run(() => cachedFingerprints(input.host, decided));
  const stale = decided.filter((id) => after.get(id) === before.get(id));
  if (stale.length === 0) return finish([], 'rewritten', decided.length);
  // Nothing is deleted for a caller that has stopped.
  input.signal?.throwIfAborted();
  await span.run(() =>
    input.host.deleteRecords(
      stale.map((id) => `${DOCUMENT_RECORD_PREFIX}${id}`),
      session
    )
  );
  try {
    // Not cancelled with the caller: once a record is deleted, this read is
    // what writes back a document restored meanwhile, with every field the
    // lists that hold it read.
    const still = await goneOnPrimary(stale, read, undefined, 'full', span);
    span.setAttr(
      'soup.documents.restored',
      stale.filter((id) => !still.has(id)).length
    );
  } catch {
    // The document stays out of the cache until a list fetches it again.
    return finish(stale, 'removed_unconfirmed', decided.length);
  }
  return finish(stale, 'removed', decided.length);
}

export type DocumentVerifierOptions = {
  host?: () => DocumentReconcileHost | undefined;
  readFromPrimary?: ReadDocumentFromPrimary;
  session?: () => string;
  now?: () => number;
};

export type DocumentVerifier = {
  /** Checks `ids` on the primary in the background, deleting the cached
   * records of those the viewer can no longer read. Each id is checked at
   * most once per `VERIFY_TTL_MS`. */
  verify: (ids: readonly string[]) => void;
  /** Stops checks in flight; later calls do nothing. */
  dispose: () => void;
};

/**
 * A verifier for the documents a search surface matches locally by name.
 * Local name search reads only the cache, so a document deleted or unshared
 * while this client missed the realtime patch stays listed (as a Featured
 * result, with its old name) until something reads it on the server again.
 * The verifier is that read, made only for the few documents a search
 * features, and at most once per document per few minutes.
 */
export function createDocumentVerifier(
  options: DocumentVerifierOptions = {}
): DocumentVerifier {
  const hostOf = options.host ?? getGraphqlSoupCacheHost;
  const now = options.now ?? Date.now;
  const checkedAt = new Map<string, number>();
  /** Due ids waiting for the check running now, if any. */
  const queued = new Set<string>();
  /** Ids of the running check that a search featured again meanwhile. */
  const featuredAgain = new Set<string>();
  let running: readonly string[] | undefined;
  const controller = new AbortController();

  const isDue = (id: string, at: number) => {
    const last = checkedAt.get(id);
    return last === undefined || at - last >= VERIFY_TTL_MS;
  };

  // One check at a time, so overlapping searches never have more than
  // PRIMARY_READ_CONCURRENCY documents read at once.
  const drain = async (host: DocumentReconcileHost) => {
    while (queued.size > 0 && !controller.signal.aborted) {
      const ids = [...queued];
      queued.clear();
      running = ids;
      try {
        const { removed } = await removeDocumentsGoneOnPrimary({
          host,
          ids,
          readFromPrimary: options.readFromPrimary,
          session: options.session,
          signal: controller.signal,
        });
        // A removed document is no longer listed, so it costs no read; if a
        // lagging list writes it back, it is checked again when featured,
        // including by a search made while this check was running.
        for (const id of removed) {
          checkedAt.delete(id);
          if (featuredAgain.has(id)) queued.add(id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        // A failed check is tried again on the next search that features it.
        for (const id of ids) checkedAt.delete(id);
        throw error;
      } finally {
        running = undefined;
        featuredAgain.clear();
      }
    }
  };

  return {
    verify: (ids) => {
      if (controller.signal.aborted) return;
      // Without a cache there is nothing to check yet, and nothing is marked
      // checked, so the next search checks once the cache is ready.
      const host = hostOf();
      if (!host || host.disabled) return;
      const at = now();
      for (const id of new Set(ids)) {
        if (running?.includes(id)) featuredAgain.add(id);
        else if (isDue(id, at)) {
          checkedAt.set(id, at);
          queued.add(id);
        }
      }
      if (running || queued.size === 0) return;
      fireAndForget(drain(host), 'soup-document-verify');
    },
    dispose: () => controller.abort(),
  };
}
