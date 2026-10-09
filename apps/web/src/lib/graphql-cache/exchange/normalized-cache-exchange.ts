/**
 * urql exchange backed by the normalized wasm cache (via a `CacheHost`).
 *
 * Differences from `@urql/exchange-graphcache`:
 * - cache reads are **async** (the cache is disk-backed, possibly in another
 *   worker/process). Cache-first misses enter the network queue after reading;
 *   cache-and-network queries start the network without waiting for storage;
 * - invalidation is push-based: the host emits "these operation keys must
 *   re-execute" (local sibling writes, other tabs/webviews, external
 *   invalidations) and the exchange re-executes them as `cache-first`.
 *
 * Request policies:
 * - `cache-first` (default): hit → emit; miss → network.
 * - `cache-and-network`: read and fetch concurrently; a cache hit may emit with
 *   `stale: true` only before newer results supersede that read. (`toPromise()`
 *   ignores stale results, so imperative callers keep network-fresh semantics.)
 * - `network-only`: skip read; response still written to cache.
 * - Foreground network query results publish before persistence. Their private
 *   metadata carries a revision acknowledgement for local reconciliation; writes
 *   remain ordered, and acknowledgements never replay the response payload.
 * - `cache-only`: hit → emit; miss → emit `data: undefined`, no network.
 *
 * Mutations:
 * - With an optimistic response (see `executeOptimisticMutation`): the
 *   mutation and layer are durably queued before the ordered runner
 *   (`mutation-queue-runner.ts`) forwards it. Retryable failures retain optimism for background replay, but the tenth
 *   server failure permanently rolls back; transport failures are not counted.
 *   Other permanent failures roll back immediately. A caller blocked behind the queue
 *   head receives a synthetic `queued` disposition instead of waiting.
 * - Without one: forwarded normally; successful responses are normalized
 *   through the standard write path so dependent cached queries update.
 *
 * Cache failures normally degrade to the network. An admitted optimistic
 * enqueue with an unfenced transport outcome emits an error instead, because
 * forwarding could duplicate a side effect already durable in the old scope.
 */

import {
  type Client,
  CombinedError,
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import {
  type DocumentNode,
  Kind,
  type OperationDefinitionNode,
  visit,
} from 'graphql';
import { batch } from 'solid-js';
import {
  empty,
  filter,
  fromPromise,
  fromValue,
  makeSubject,
  map,
  merge,
  mergeMap,
  pipe,
  type Source,
  share,
  tap,
} from 'wonka';
import { supportsStoreReconciliation } from '../../urql-solid/reactive-selection';
import type { CacheHost } from '../host/types';
import {
  type CacheRevision,
  type ClaimedMutation,
  type EnqueueOptimisticMutationResult,
  isAdmittedEnqueueUncertainError,
  isCacheRevision,
  isOwnerEpochLostError,
  isOwnerLockUnavailableError,
  type QueryRevalidationWire,
} from '../protocol';
import { createDeferredQueryRereads } from './deferred-query-rereads';
import { createDocumentQueryReader } from './document-query-reader';
import {
  compileEntityResolvers,
  type EntityResolverConfig,
} from './entity-resolvers';
import { isQueryObject, LiveQuery, withLiveQueryData } from './live-query';
import {
  createMutationQueueRunner,
  QUEUE_LEASE_MS,
  QUEUE_REQUEST_TIMEOUT_MS,
  queueAttemptOf,
  replayDocument,
  withQueueRequestTimeout,
} from './mutation-queue-runner';
import type { QueryRevalidation } from './optimistic';
import {
  normalizedEntityKey,
  notifyOptimisticMutationEnqueued,
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from './optimistic';
import { queryShape } from './query-shape';

/** Server writes acknowledged since this query left for the network. */
const QUERY_MUTATION_VERSION_CONTEXT_KEY =
  'normalizedCacheQueryMutationVersion';
/** Marks dependency-pushed reads as latency-sensitive worker work. */
const AFFECTED_READ_CONTEXT_KEY = 'normalizedCacheAffectedRead';
/** Prevents a replacement-registration cache read from forwarding the API again. */
const REPLACEMENT_REGISTRATION_ONLY_CONTEXT_KEY =
  'normalizedCacheReplacementRegistrationOnly';
/** Marks a query as network-to-cache hydration with a projected result. */
export const HYDRATE_ONLY_CONTEXT_KEY = 'normalizedCacheHydrateOnly';
/** Retains the client-annotated document while the transport uses a stripped copy. */
const HYDRATION_DOCUMENT_CONTEXT_KEY = 'normalizedCacheHydrationDocument';

const NORMALIZED_CACHE_RESULT_METADATA_KEY = '__macroNormalizedCache';

/** Private authority metadata attached by the normalized-cache exchange. */
export type NormalizedCacheResultMetadata =
  | {
      source: 'live-network';
      /** Subscription effects finished successfully in this cache generation. */
      cacheEffectsApplied?: boolean;
      revision?: CacheRevision;
      /** Local-only acknowledgement; never rejects or republishes response data. */
      persistence?: Promise<CacheRevision | undefined>;
    }
  | { source: 'normalized-cache-hit' }
  | { source: 'normalized-cache-patch' }
  | { source: 'affected-cache-reread' };

/** Reads normalized-cache authority metadata from an urql operation result. */
export function normalizedCacheResultMetadata(
  result: Pick<OperationResult, 'extensions'>
): NormalizedCacheResultMetadata | undefined {
  const metadata = result.extensions?.[NORMALIZED_CACHE_RESULT_METADATA_KEY];
  if (metadata === null || typeof metadata !== 'object') return;
  const source = (metadata as { source?: unknown }).source;
  if (
    source === 'normalized-cache-hit' ||
    source === 'affected-cache-reread' ||
    source === 'normalized-cache-patch'
  ) {
    return { source };
  }
  if (source !== 'live-network') return;
  const { revision, persistence, cacheEffectsApplied } = metadata as {
    cacheEffectsApplied?: unknown;
    revision?: unknown;
    persistence?: unknown;
  };
  return {
    source,
    ...(typeof cacheEffectsApplied === 'boolean'
      ? { cacheEffectsApplied }
      : {}),
    ...(isCacheRevision(revision) ? { revision } : {}),
    ...(isThenable(persistence)
      ? { persistence: persistence as Promise<CacheRevision | undefined> }
      : {}),
  };
}

// zone.js replaces the global Promise, so a native async function's promise
// fails `instanceof Promise` in the app.
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function withResultMetadata(
  result: OperationResult,
  metadata: NormalizedCacheResultMetadata
): OperationResult {
  return {
    ...result,
    extensions: {
      ...result.extensions,
      [NORMALIZED_CACHE_RESULT_METADATA_KEY]: metadata,
    },
  };
}

const queryTextCache = new WeakMap<object, string>();

function queryText(op: Operation): string {
  const doc = op.query;
  let text = queryTextCache.get(doc);
  if (text === undefined) {
    text = stringifyDocument(doc);
    queryTextCache.set(doc, text);
  }
  return text;
}

function hydrationDocument(op: Operation): DocumentNode | undefined {
  const document: unknown = op.context[HYDRATION_DOCUMENT_CONTEXT_KEY];
  return document && typeof document === 'object'
    ? (document as DocumentNode)
    : undefined;
}

function cacheQueryText(op: Operation): string {
  const document = hydrationDocument(op);
  if (!document) return queryText(op);
  let text = queryTextCache.get(document);
  if (text === undefined) {
    text = stringifyDocument(document);
    queryTextCache.set(document, text);
  }
  return text;
}

function isHydrateOnly(op: Operation): boolean {
  return op.context[HYDRATE_ONLY_CONTEXT_KEY] === true;
}

const transportDocumentCache = new WeakMap<object, DocumentNode>();

function hydrationTransportOperation(op: Operation): Operation {
  let document = transportDocumentCache.get(op.query);
  if (!document) {
    document = visit(op.query, {
      Directive(node) {
        return node.name.value === 'cacheOnly' ? null : undefined;
      },
    });
    transportDocumentCache.set(op.query, document);
  }
  return makeOperation(
    op.kind,
    { ...op, query: document },
    {
      ...op.context,
      requestPolicy: 'network-only',
      [HYDRATION_DOCUMENT_CONTEXT_KEY]: hydrationDocument(op) ?? op.query,
    }
  );
}

function operationName(op: Operation): string | undefined {
  for (const def of op.query.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      return (def as OperationDefinitionNode).name?.value;
    }
  }
  return undefined;
}

function cacheResult(
  op: Operation,
  data: unknown,
  stale: boolean,
  source: Extract<
    NormalizedCacheResultMetadata,
    { source: 'normalized-cache-hit' | 'affected-cache-reread' }
  >['source'] = 'normalized-cache-hit'
): OperationResult {
  return withResultMetadata(
    {
      operation: op,
      data,
      error: undefined,
      extensions: undefined,
      stale,
      hasNext: false,
    },
    { source }
  );
}

type CacheEffect =
  | { kind: 'write'; data: unknown }
  | { kind: 'delete'; key: string };

/** Returns the normalized key carried by the cache-deletion GraphQL type. */
function graphqlCacheDeletionKey(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (
    record.__typename !== 'GraphqlCacheDeletion' ||
    typeof record.graphqlTypeName !== 'string' ||
    typeof record.entityId !== 'string'
  ) {
    return;
  }
  return normalizedEntityKey({
    __typename: record.graphqlTypeName,
    id: record.entityId,
  });
}

/** Returns whether a response subtree contains an explicit cache deletion. */
function containsCacheDeletion(data: unknown): boolean {
  if (graphqlCacheDeletionKey(data) !== undefined) return true;
  if (data === null || typeof data !== 'object') return false;
  return Array.isArray(data)
    ? data.some(containsCacheDeletion)
    : Object.values(data).some(containsCacheDeletion);
}

/**
 * Converts any GraphQL operation payload into ordered cache effects. Ordinary
 * data remains one normalized write. When an explicit cache deletion is nested
 * in an object or list, writes are narrowed to the corresponding response path
 * so surrounding writes and deletions retain their wire order. Response keys
 * and ancestor scalar context (including `__typename`) are copied verbatim,
 * which preserves aliases and inline-fragment resolution without schema or
 * operation knowledge.
 */
function operationCacheEffects(data: unknown): CacheEffect[] {
  const deletionKey = graphqlCacheDeletionKey(data);
  if (deletionKey !== undefined) {
    return [{ kind: 'delete', key: deletionKey }];
  }
  if (!containsCacheDeletion(data)) return [{ kind: 'write', data }];

  if (Array.isArray(data)) {
    return data.flatMap((value) =>
      operationCacheEffects(value).map((effect) =>
        effect.kind === 'write'
          ? {
              kind: 'write' as const,
              // Safe only for transient operation-root effect lists such as
              // `soupUpdates`/`effects`, never normalized entity link lists.
              data: [effect.data],
            }
          : effect
      )
    );
  }

  if (data === null || typeof data !== 'object') {
    return [{ kind: 'write', data }];
  }

  const entries = Object.entries(data);
  const context = entries.filter(([, value]) => !containsCacheDeletion(value));
  const effectFields = entries.filter(([, value]) =>
    containsCacheDeletion(value)
  );

  return effectFields.flatMap(([effectField, value]) =>
    operationCacheEffects(value).map((effect) => {
      if (effect.kind === 'delete') return effect;

      const wrapped: Record<string, unknown> = {};
      for (const [field, fieldValue] of entries) {
        if (field === effectField) wrapped[field] = effect.data;
        else if (context.some(([contextField]) => contextField === field)) {
          wrapped[field] = fieldValue;
        }
      }
      return { kind: 'write' as const, data: wrapped };
    })
  );
}

function uncertainEnqueueResult(op: Operation, error: Error): OperationResult {
  return {
    operation: op,
    data: undefined,
    error: new CombinedError({ networkError: error }),
    extensions: undefined,
    stale: false,
    hasNext: false,
  };
}

export interface NormalizedCacheExchangeOptions {
  /** Best-effort startup recovery before per-mutation admission. */
  prepareMutationQueue?: () => Promise<void>;
  /** False discards obsolete client intent without sending it to the server. */
  beforeMutationAttempt?: (mutation: ClaimedMutation) => Promise<boolean>;
  /** Persist domain recovery state for a replayed result, including when its UI is closed. */
  onMutationAttemptResult?: (
    mutation: ClaimedMutation,
    result: OperationResult,
    retry: boolean
  ) => Promise<void>;
  /** Domain-specific deletions inferred from a successful server response. */
  deletedRecordKeys?: (result: OperationResult) => string[];
  /** Return true to transfer a committed query refresh to an active reader's queue.
   * Persisted descriptors without an owner retain the normal network fallback. */
  delegateRevalidation?: (client: Client, query: QueryRevalidation) => boolean;
  /** Schema-typed singular entity relations derived from field arguments. */
  entityResolvers?: EntityResolverConfig;
  /** Called when cache work fails; the operation may degrade or emit uncertainty. */
  onCacheError?: (error: unknown, op: Operation) => void;
  /**
   * Extracts the session identity (e.g. viewer id, `data.user.id`) from a
   * response. The extracted value is passed to the cache as an opaque tag;
   * a write tagged with a different identity than the one bound to the
   * cache wipes and rebinds it atomically (silent restart), and every
   * active operation re-executes. Schema knowledge lives here — the cache
   * layer itself is identity-agnostic.
   */
  extractIdentity?: (data: unknown) => string | undefined;
  /**
   * Decides whether a failed optimistic mutation remains queued. The caller
   * receives a `queued` disposition; `true` retains the optimistic layer for
   * a later background attempt. Defaults to `false`.
   */
  shouldRetryMutation?: (error: CombinedError) => boolean | Promise<boolean>;
}

export function normalizedCacheExchange(
  host: CacheHost,
  options: NormalizedCacheExchangeOptions = {}
): Exchange {
  const entityResolvers = compileEntityResolvers(options.entityResolvers);
  return ({ forward, client }) => {
    /** Operations registered with the host, for push-driven re-execution. */
    const activeOps = new Map<number, Operation>();
    const documentReader = createDocumentQueryReader(host);
    let cacheGeneration = 0;
    let mutationVersion = 0;
    host.onMutationSettled((settlement) => {
      // Another tab's durable queue runner can commit into this same cache.
      if (settlement.status !== 'permanently-failed') mutationVersion += 1;
    });
    const liveQueries = new Map<
      number,
      { view: LiveQuery; result: OperationResult }
    >();
    const { source: affectedResults$, next: emitAffectedResult } =
      makeSubject<OperationResult>();
    type RetainedReplacementFallback = {
      version: number;
      writeArgs: Parameters<CacheHost['writeQuery']>[0];
      readyPending: boolean;
      recovering: boolean;
      invalidated: boolean;
      recoveryPromise?: Promise<void>;
    };
    type QueryState = {
      /** Includes background persistence for dependency/replacement ordering. */
      networkBoundQueries: number;
      networkRequestsInFlight: number;
      replacementFallback: boolean;
      deferredAffected: boolean;
      completedReplacementFallback: boolean;
      networkRegistrationSatisfied: boolean;
      retainedReplacementFallback?: RetainedReplacementFallback;
      networkResultVersion: number;
      cacheReadVersion: number;
      networkError?: CombinedError;
    };
    // Keep write ordering across teardown/remount, including imperative queries
    // that unsubscribe as soon as the early network result reaches toPromise().
    const queryResultTurns = new Map<number, Promise<void>>();
    const queryStates = new Map<number, QueryState>();
    const queryState = (key: number): QueryState => {
      let state = queryStates.get(key);
      if (!state) {
        state = {
          networkBoundQueries: 0,
          networkRequestsInFlight: 0,
          replacementFallback: false,
          deferredAffected: false,
          completedReplacementFallback: false,
          networkRegistrationSatisfied: false,
          networkResultVersion: 0,
          cacheReadVersion: 0,
        };
        queryStates.set(key, state);
      }
      return state;
    };

    // Async reads must not resurrect a torn-down operation, overwrite a newer
    // network result, or undo a subsequent optimistic/affected cache reread.
    const beginCacheRead = (key: number): (() => boolean) => {
      const state = queryState(key);
      const version = ++state.cacheReadVersion;
      const generation = cacheGeneration;
      return () =>
        generation === cacheGeneration &&
        activeOps.has(key) &&
        queryStates.get(key) === state &&
        state.cacheReadVersion === version;
    };

    const acquireQueryResultTurn = async (key: number): Promise<() => void> => {
      const previous = queryResultTurns.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      queryResultTurns.set(key, current);
      await previous;
      return () => {
        release();
        if (queryResultTurns.get(key) === current) queryResultTurns.delete(key);
      };
    };

    const invalidateOlderRetainedFallback = async (
      state: QueryState,
      version: number
    ): Promise<void> => {
      while (true) {
        const retained = state.retainedReplacementFallback;
        if (!retained || retained.version >= version) return;
        retained.invalidated = true;
        retained.readyPending = false;
        if (retained.recoveryPromise) {
          // Keep the exact in-flight candidate addressable until its cache
          // attempt settles; the newer result must write strictly after it.
          await retained.recoveryPromise;
        }
        if (state.retainedReplacementFallback === retained) {
          state.retainedReplacementFallback = undefined;
        }
      }
    };

    const reexecuteAffected = (key: number, registrationOnly = false): void => {
      const op = activeOps.get(key);
      if (!op) return;
      client.reexecuteOperation(
        makeOperation(op.kind, op, {
          ...op.context,
          requestPolicy:
            op.context.requestPolicy === 'cache-only'
              ? 'cache-only'
              : 'cache-first',
          [AFFECTED_READ_CONTEXT_KEY]: true,
          // activeOps observes every reissued operation. Explicitly clear the
          // one-shot marker so a later ordinary invalidation can reach the API.
          [REPLACEMENT_REGISTRATION_ONLY_CONTEXT_KEY]: registrationOnly,
        })
      );
    };

    const recoverRetainedReplacementFallback = (key: number): void => {
      const state = queryStates.get(key);
      const retained = state?.retainedReplacementFallback;
      if (!state || !retained || retained.invalidated || !activeOps.has(key))
        return;
      retained.readyPending = true;
      if (retained.recovering || state.networkBoundQueries > 0) return;
      retained.recovering = true;
      const recovery = (async () => {
        while (
          queryStates.get(key) === state &&
          state.retainedReplacementFallback === retained &&
          !retained.invalidated &&
          retained.readyPending
        ) {
          retained.readyPending = false;
          try {
            await host.writeQuery({
              ...retained.writeArgs,
              registerDependencies: true,
            });
            if (
              queryStates.get(key) !== state ||
              state.retainedReplacementFallback !== retained ||
              retained.invalidated ||
              !activeOps.has(key)
            ) {
              return;
            }
            if (
              queryStates.get(key) !== state ||
              state.retainedReplacementFallback !== retained ||
              retained.invalidated
            ) {
              return;
            }
            state.retainedReplacementFallback = undefined;
            state.replacementFallback = false;
            state.deferredAffected = false;
            state.completedReplacementFallback = false;
            state.networkRegistrationSatisfied = false;
            return;
          } catch (error) {
            if (
              queryStates.get(key) !== state ||
              state.retainedReplacementFallback !== retained ||
              retained.invalidated
            ) {
              return;
            }
            const active = activeOps.get(key);
            if (active) options.onCacheError?.(error, active);
            // Preserve the successful payload for a later replacement-ready
            // notification. A notification received during this attempt sets
            // readyPending and safely drives exactly one subsequent attempt.
          }
        }
      })().catch(() => undefined);
      retained.recoveryPromise = recovery;
      void recovery.then(() => {
        if (retained.recoveryPromise === recovery) {
          retained.recoveryPromise = undefined;
        }
        if (
          queryStates.get(key) !== state ||
          state.retainedReplacementFallback !== retained
        )
          return;
        retained.recovering = false;
        if (retained.invalidated) {
          state.retainedReplacementFallback = undefined;
        } else if (retained.readyPending) {
          recoverRetainedReplacementFallback(key);
        }
      });
    };

    const pendingAffectedReads = new Set<Promise<void>>();
    const trackAffectedRead = (read: Promise<void>): void => {
      pendingAffectedReads.add(read);
      const settled = () => pendingAffectedReads.delete(read);
      void read.then(settled, settled);
    };

    const emitAffectedWhileNetworkBound = async (
      key: number
    ): Promise<void> => {
      const operation = activeOps.get(key);
      if (!operation) return;
      const state = queryState(key);
      // Supersede the initial cache snapshot. An affected reread carries newer
      // local/optimistic state, so let it complete even if network persistence
      // finishes first; only teardown/remount may discard that update.
      state.cacheReadVersion += 1;
      const generation = cacheGeneration;
      await documentReader
        .read({
          opKey: operation.key,
          query: queryText(operation),
          operationName: operationName(operation),
          variables: operation.variables as Record<string, unknown> | undefined,
          priority: 'user-visible',
          entityResolvers,
        })
        .then((read) => {
          const active = activeOps.get(key);
          if (
            generation !== cacheGeneration ||
            read.kind !== 'hit' ||
            !active ||
            queryStates.get(key) !== state
          )
            return;
          // Preserve the authoritative request while immediately surfacing the
          // newer local view. Its eventual result still gets the deferred
          // cache reread below when it could not register fresh dependencies.
          emitAffectedResult(
            cacheResult(
              active,
              read.data,
              state.networkRequestsInFlight > 0,
              'affected-cache-reread'
            )
          );
        })
        .catch((error) => options.onCacheError?.(error, operation));
    };

    // Deliver cache changes directly. Reexecuting through urql first replays
    // the previous network result as stale, which can reset collection sources
    // and replay their persistence acknowledgements during an optimistic edit.
    const emitWatchedQuery = async (key: number): Promise<void> => {
      const operation = activeOps.get(key);
      if (!operation) return;
      const isCurrent = beginCacheRead(key);
      try {
        const read = await documentReader.read({
          opKey: key,
          query: queryText(operation),
          operationName: operationName(operation),
          variables: operation.variables as Record<string, unknown> | undefined,
          priority: 'user-visible',
          entityResolvers,
        });
        if (!isCurrent()) return;
        if (read.kind === 'hit') {
          emitAffectedResult(
            cacheResult(operation, read.data, false, 'affected-cache-reread')
          );
          return;
        }
      } catch (error) {
        options.onCacheError?.(error, operation);
        if (!isCurrent()) return;
      }
      reexecuteAffected(key);
    };

    const affectedRereads = createDeferredQueryRereads(
      (key, registrationOnly) => {
        if (!activeOps.has(key)) return;
        const state = queryStates.get(key);
        // A request or worker replacement may have started while this read was
        // deferred. Re-check current state instead of replaying a stale action.
        if (state?.retainedReplacementFallback) {
          recoverRetainedReplacementFallback(key);
        } else if (state && state.networkBoundQueries > 0) {
          state.deferredAffected = true;
          if (!state.replacementFallback)
            trackAffectedRead(emitAffectedWhileNetworkBound(key));
        } else if (
          host.watchQuery &&
          !registrationOnly &&
          liveQueries.has(key) &&
          !liveQueries.get(key)?.result.error &&
          !liveQueries.get(key)?.result.hasNext
        ) {
          trackAffectedRead(emitWatchedQuery(key));
        } else {
          reexecuteAffected(key, registrationOnly);
        }
      }
    );

    const unsubscribePush = host.onOpsAffected((opKeys) =>
      batch(() => {
        for (const key of opKeys) {
          if (!activeOps.has(key)) continue;
          const state = queryState(key);
          if (state.networkBoundQueries > 0) {
            state.deferredAffected = true;
            if (
              !state.replacementFallback &&
              !state.retainedReplacementFallback
            ) {
              affectedRereads.request(key);
            }
            continue;
          }
          const registrationOnly = state.completedReplacementFallback;
          state.completedReplacementFallback = false;
          state.replacementFallback = false;
          if (state.retainedReplacementFallback) {
            recoverRetainedReplacementFallback(key);
            continue;
          }
          affectedRereads.request(key, registrationOnly);
        }
      })
    );

    return (ops$) => {
      const shared = pipe(ops$, share);

      // Async cache reads re-inject network-bound operations here.
      const { source: forwardQueue$, next: enqueueForward } =
        makeSubject<Operation>();
      const hydrationRequests = new Set<number>();

      const atMutationVersion = (op: Operation): Operation =>
        makeOperation('query', op, {
          ...op.context,
          [QUERY_MUTATION_VERSION_CONTEXT_KEY]: mutationVersion,
        });

      const enqueueHydrationForward = (op: Operation): void => {
        const request = atMutationVersion(hydrationTransportOperation(op));
        hydrationRequests.add(op.key);
        enqueueForward(request);
      };

      const enqueueQueryForward = (op: Operation): void => {
        const state = queryState(op.key);
        state.networkBoundQueries += 1;
        state.networkRequestsInFlight += 1;
        state.networkError = undefined;
        enqueueForward(atMutationVersion(op));
      };

      const predatesMutation = (op: Operation): boolean => {
        const version: unknown = op.context[QUERY_MUTATION_VERSION_CONTEXT_KEY];
        return typeof version === 'number' && version < mutationVersion;
      };

      // A response from before an acknowledged write cannot safely replace
      // either live data or normalized records. Fetch a new snapshot without
      // replaying urql's previous result or dropping the mounted subscription.
      const refreshObsoleteQuery = (op: Operation): void => {
        const active = activeOps.get(op.key);
        if (active && active.context.requestPolicy !== 'cache-only') {
          enqueueQueryForward(active);
        }
      };

      const finishNetworkQuery = (
        key: number,
        state: QueryState,
        replacementRegistrationSatisfied: boolean
      ): void => {
        if (queryStates.get(key) !== state) return;
        const remaining = state.networkBoundQueries - 1;
        if (remaining > 0) {
          state.networkBoundQueries = remaining;
          return;
        }
        state.networkBoundQueries = 0;
        const deferred = state.deferredAffected;
        state.deferredAffected = false;
        const replacementFallback = state.replacementFallback;
        state.replacementFallback = false;
        if (deferred) {
          state.completedReplacementFallback = false;
          if (!replacementRegistrationSatisfied) {
            if (state.retainedReplacementFallback) {
              recoverRetainedReplacementFallback(key);
            } else if (activeOps.has(key)) {
              affectedRereads.request(key, true);
            }
          }
        } else if (replacementFallback) {
          // A fast fallback completed before replacement initialization. The
          // later affected notification must register cache dependencies but
          // must not issue the API request a second time.
          state.completedReplacementFallback = true;
        }
      };

      const queueOwner = `exchange:${host.clientId}`;
      const mutationQueue = createMutationQueueRunner({
        host,
        client,
        options,
        owner: queueOwner,
        forward: enqueueForward,
        writeThrough,
        cacheDocument: (op) => ({
          query: queryText(op),
          operationName: operationName(op),
          variables: op.variables as Record<string, unknown> | undefined,
        }),
        deleteReportedRecords,
        replayExplicitEffects: (op, data, isCurrent) => {
          const effects = operationCacheEffects(data);
          // Commit already normalized the complete result. Replay only mixed
          // explicit effects so their final write/delete order is identical
          // to a non-optimistic operation.
          return effects.some((effect) => effect.kind === 'delete')
            ? applyOperationCacheEffects(op, effects, isCurrent)
            : undefined;
        },
        revalidate: revalidateAfterSettlement,
      });
      const subscriptionEffectChains = new Map<number, Promise<boolean>>();
      // Teardown invalidates queued effects, including when the same operation
      // is immediately resubscribed after a back/forward-cache restore.
      const subscriptionGenerations = new Map<number, object>();

      async function revalidateAfterSettlement(
        revalidations: QueryRevalidationWire[],
        mutation?: Operation
      ): Promise<void> {
        const reportError = (error: unknown, operation = mutation) => {
          // Diagnostics cannot turn a durably settled attempt back into a retry.
          if (!operation) return;
          try {
            options.onCacheError?.(error, operation);
          } catch {
            // The settlement is already final.
          }
        };
        const repairs: Promise<void>[] = [];
        async function refresh(revalidation: QueryRevalidationWire) {
          try {
            const variables: unknown = JSON.parse(revalidation.variablesJson);
            if (
              variables === null ||
              typeof variables !== 'object' ||
              Array.isArray(variables)
            ) {
              throw new Error('cache revalidation variables are not an object');
            }
            const document = replayDocument(
              revalidation.query,
              revalidation.operationName
            );
            if (
              options.delegateRevalidation?.(client, {
                document,
                variables: variables as Record<string, unknown>,
              })
            )
              return;
            const result = await client
              .query(document, variables as Record<string, unknown>, {
                requestPolicy: 'network-only',
              })
              .toPromise();
            if (result.error)
              reportError(result.error, mutation ?? result.operation);
            const metadata = normalizedCacheResultMetadata(result);
            if (metadata?.source === 'live-network') await metadata.persistence;
          } catch (error) {
            reportError(error);
          }
        }
        for (const revalidation of revalidations) {
          const pending = refresh(revalidation);
          // Ordinary membership refreshes continue in the background.
          if (revalidation.onlyOnLinkFailure) repairs.push(pending);
        }
        if (repairs.length === 0 && pendingAffectedReads.size === 0) return;
        const deliver = async () => {
          await Promise.all(repairs);
          // Persistence schedules subscriber reads but does not publish their
          // values. Even a healthy commit must hand off optimism to those reads.
          while (pendingAffectedReads.size > 0) {
            await Promise.allSettled([...pendingAffectedReads]);
          }
        };
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Include shared requests, persistence, and subscriber publication.
          // A slow read must not block the mutation queue indefinitely.
          await Promise.race([
            deliver(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(new Error('Timed out delivering mutation updates')),
                QUEUE_REQUEST_TIMEOUT_MS
              );
            }),
          ]);
        } catch (error) {
          reportError(error);
        } finally {
          clearTimeout(timeout);
        }
      }

      async function readThenRoute(
        op: Operation
      ): Promise<OperationResult | undefined> {
        if (isHydrateOnly(op)) {
          enqueueHydrationForward(op);
          return undefined;
        }
        const readState = queryState(op.key);
        const isCurrentRead = beginCacheRead(op.key);
        const policy = op.context.requestPolicy;
        if (policy === 'network-only') {
          enqueueQueryForward(op);
          return undefined;
        }
        const registrationOnly =
          op.context[REPLACEMENT_REGISTRATION_ONLY_CONTEXT_KEY] === true;
        let networkForwarded = false;
        try {
          const pendingRead = documentReader.read({
            opKey: op.key,
            query: queryText(op),
            operationName: operationName(op),
            variables: op.variables as Record<string, unknown> | undefined,
            entityResolvers,
            priority:
              op.context[AFFECTED_READ_CONTEXT_KEY] === true
                ? 'user-visible'
                : undefined,
          });
          // Admit the cache read first, but never wait for the worker's queue
          // before starting a request that needs the network regardless.
          if (policy === 'cache-and-network' && !registrationOnly) {
            networkForwarded = true;
            enqueueQueryForward(op);
          }
          const read = await pendingRead;
          if (!isCurrentRead()) return undefined;
          if (read.kind === 'hit') {
            const state = queryState(op.key);
            const stale = networkForwarded && state.networkRequestsInFlight > 0;
            return {
              ...cacheResult(op, read.data, stale),
              // A fast offline failure must not discard a slower usable cache
              // hit, nor may that hit erase the failed revalidation's error.
              error: networkForwarded ? state.networkError : undefined,
            };
          }
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        } catch (error) {
          options.onCacheError?.(error, op);
          if (
            isOwnerEpochLostError(error) &&
            queryStates.get(op.key) === readState &&
            (isCurrentRead() || readState.networkBoundQueries > 0)
          ) {
            readState.replacementFallback = true;
          }
          if (!isCurrentRead()) return undefined;
          // `cache-only` must never touch the network, even when the cache
          // itself fails — degrade to an empty result instead.
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        }
        if (!networkForwarded && !registrationOnly) enqueueQueryForward(op);
        return undefined;
      }

      /** Durably queues optimism before allowing the ordered runner to send. */
      async function prepareMutation(
        op: Operation
      ): Promise<OperationResult | undefined> {
        const epoch = mutationQueue.epoch();
        if (host.disabled) {
          notifyOptimisticMutationEnqueued(op);
          enqueueForward(op);
          return undefined;
        }
        // Reconstructed startup retries already have a durable transaction.
        if (queueAttemptOf(op)) {
          enqueueForward(withQueueRequestTimeout(op));
          return undefined;
        }
        const optimistic = optimisticContextOf(op);
        if (!optimistic) {
          enqueueForward(op);
          return undefined;
        }
        const args = {
          uuid: optimistic.uuid,
          query: queryText(op),
          operationName: operationName(op),
          variables: op.variables as Record<string, unknown> | undefined,
          data: optimistic.optimisticResponse,
          linkPatches: optimistic.linkPatches,
          revalidations: optimistic.revalidations,
          identityBindings: optimistic.identityBindings,
          clientMetadata: optimistic.clientMetadata,
          uncertainCalendarEventKeys: optimistic.uncertainCalendarEventKeys,
        };
        const now = Date.now();
        const claim = {
          owner: queueOwner,
          nowMs: now,
          leaseExpiresAtMs: now + QUEUE_LEASE_MS,
        };
        let enqueue: EnqueueOptimisticMutationResult;
        try {
          enqueue = await host.enqueueOptimisticMutation(args, claim);
        } catch (error) {
          if (!mutationQueue.isCurrent(epoch))
            return uncertainEnqueueResult(
              op,
              new Error('cache storage changed during enqueue', {
                cause: error,
              })
            );
          if (isAdmittedEnqueueUncertainError(error)) {
            options.onCacheError?.(error, op);
            // The old-scope queue may already contain the side effect. It is
            // unsafe to forward or retry without a coordinator fence.
            return uncertainEnqueueResult(op, error);
          }
          // Another context holds the database, so the enqueue never reached
          // an engine. Send it as a disabled cache would.
          if (isOwnerLockUnavailableError(error)) {
            enqueueForward(op);
            return undefined;
          }
          // A cached bin/page may disappear between inspect and enqueue. Do
          // not expose a partial relation move: retain entity optimism and
          // the post-success revalidation descriptors instead.
          if (args.linkPatches.length === 0) {
            options.onCacheError?.(error, op);
            enqueueForward(op);
            return undefined;
          }
          // Deliberately loud: this fallback is durable but invisible until
          // reconnect — the mutation's optimistic list membership silently
          // becomes eventual. A systematic rejection (schema drift, a patch
          // path the cache cannot resolve) looks identical to a transient
          // race without this trace, and production wires no onCacheError.
          const degraded = new Error(
            'optimistic link patches rejected at enqueue; degrading to ' +
              `post-commit revalidations for ${args.operationName ?? 'mutation'}`,
            { cause: error }
          );
          console.warn(`[graphql-cache] ${degraded.message}`, error);
          options.onCacheError?.(degraded, op);
          try {
            enqueue = await host.enqueueOptimisticMutation(
              {
                ...args,
                linkPatches: [],
                revalidations: [
                  ...args.revalidations,
                  // Fragment recipes are not executable queries. Their callers
                  // provide targeted recovery queries in args.revalidations.
                  ...args.linkPatches
                    .filter((patch) => !patch.recordRoot)
                    .map((patch) => ({
                      query: patch.query,
                      operationName: patch.operationName,
                      variablesJson: patch.variablesJson,
                    })),
                ],
              },
              claim
            );
          } catch (fallbackError) {
            if (!mutationQueue.isCurrent(epoch))
              return uncertainEnqueueResult(
                op,
                new Error('cache storage changed during enqueue', {
                  cause: fallbackError,
                })
              );
            options.onCacheError?.(fallbackError, op);
            if (isAdmittedEnqueueUncertainError(fallbackError)) {
              return uncertainEnqueueResult(op, fallbackError);
            }
            enqueueForward(op);
            return undefined;
          }
        }
        if (!mutationQueue.isCurrent(epoch)) {
          return uncertainEnqueueResult(
            op,
            new Error('cache storage changed during enqueue')
          );
        }
        return await mutationQueue.admit(op, enqueue, epoch);
      }

      /** Applies operation cache effects serially and isolates every failure. */
      async function applyOperationCacheEffects(
        op: Operation,
        effects: CacheEffect[],
        isCurrent: () => boolean = () => true
      ): Promise<boolean> {
        let applied = true;
        for (const effect of effects) {
          if (!isCurrent()) return false;
          try {
            if (effect.kind === 'write') {
              await host.writeQuery({
                query: queryText(op),
                operationName: operationName(op),
                variables: op.variables as Record<string, unknown> | undefined,
                data: effect.data,
              });
            } else {
              await host.deleteRecords([effect.key]);
            }
          } catch (error) {
            applied = false;
            // One failed cache effect must neither skip later effects nor
            // prevent delivery of the original operation result.
            options.onCacheError?.(error, op);
          }
        }
        return applied && isCurrent();
      }

      // Persistence is still ordered/durable, but foreground query consumers do
      // not await it. The acknowledgement carries only a revision: replaying the
      // old payload here would overwrite later network or optimistic results.
      async function persistQueryResult(
        result: OperationResult,
        state: QueryState,
        resultVersion: number
      ): Promise<CacheRevision | undefined> {
        const op = result.operation;
        const releaseTurn = await acquireQueryResultTurn(op.key);
        const reportError = (error: unknown): void => {
          try {
            options.onCacheError?.(error, op);
          } catch {
            // A diagnostic callback must not reject an unobserved background
            // acknowledgement or prevent releasing this query's write turn.
          }
        };
        try {
          await invalidateOlderRetainedFallback(state, resultVersion);
          // A previous write turn may have delayed this response until after
          // mutation settlement, even though publication happened earlier.
          if (predatesMutation(op)) {
            refreshObsoleteQuery(op);
            return undefined;
          }
          // Resolver failures must not persist partial nulls as authoritative absence.
          if (result.data == null || result.error) return undefined;
          const isActive = () =>
            queryStates.get(op.key) === state && activeOps.has(op.key);
          const writeArgs = {
            opKey: op.key,
            query: queryText(op),
            operationName: operationName(op),
            variables: op.variables as Record<string, unknown> | undefined,
            entityResolvers,
            data: result.data,
            identity: options.extractIdentity?.(result.data),
            registerDependencies: isActive(),
          };
          const retained: RetainedReplacementFallback | undefined =
            result.error === undefined && result.hasNext !== true && isActive()
              ? {
                  version: resultVersion,
                  writeArgs,
                  readyPending: false,
                  recovering: false,
                  invalidated: false,
                }
              : undefined;
          if (retained && state.replacementFallback) {
            state.retainedReplacementFallback = retained;
          }
          try {
            const write = await host.writeQuery(writeArgs);
            const deletion = await deleteReportedRecords(result);
            state.networkRegistrationSatisfied = writeArgs.registerDependencies;
            if (host.watchQuery && isActive()) {
              const generation = cacheGeneration;
              void documentReader
                .read(writeArgs)
                .then((read) => {
                  const live = liveQueries.get(op.key);
                  if (
                    generation === cacheGeneration &&
                    read.kind === 'hit' &&
                    isQueryObject(read.data) &&
                    isActive() &&
                    state.networkResultVersion === resultVersion &&
                    live &&
                    live.view.snapshot === result.data
                  ) {
                    live.view.replace(read.data);
                  }
                })
                .catch(reportError);
            }
            if (state.retainedReplacementFallback === retained) {
              state.retainedReplacementFallback = undefined;
            }
            return deletion?.revision ?? write.revision;
          } catch (error) {
            reportError(error);
            // An old-owner failure can arrive after this write started. Retain
            // only the latest successful response for replacement registration.
            if (
              retained &&
              isActive() &&
              state.networkResultVersion === resultVersion &&
              (state.replacementFallback || isOwnerEpochLostError(error))
            ) {
              state.replacementFallback = true;
              state.retainedReplacementFallback = retained;
            }
            return undefined;
          }
        } catch (error) {
          reportError(error);
          return undefined;
        } finally {
          try {
            if (result.hasNext !== true) {
              const registered = state.networkRegistrationSatisfied;
              state.networkRegistrationSatisfied = false;
              finishNetworkQuery(op.key, state, registered);
            }
          } catch (error) {
            reportError(error);
          } finally {
            releaseTurn();
          }
        }
      }

      async function deleteReportedRecords(result: OperationResult) {
        const op = result.operation;
        if (result.error || result.hasNext || result.data == null) return;
        try {
          const keys = options.deletedRecordKeys?.(result) ?? [];
          if (keys.length) return await host.deleteRecords(keys);
        } catch (error) {
          options.onCacheError?.(error, op);
        }
      }

      async function writeThrough(
        result: OperationResult
      ): Promise<OperationResult | undefined> {
        const op = result.operation;
        if (
          op.kind === 'mutation' &&
          result.data != null &&
          !result.error &&
          !result.hasNext
        ) {
          mutationVersion += 1;
        }
        const output =
          op.kind === 'query'
            ? withResultMetadata(result, { source: 'live-network' })
            : result;
        if (op.kind === 'subscription' && result.data != null) {
          // Serialize effects across every emission for this operation, as
          // well as within buffered payloads, so a slower earlier write cannot
          // overtake a later delete. Subscribers still receive each original
          // result after its effects settle.
          const previousEffects =
            subscriptionEffectChains.get(op.key) ?? Promise.resolve(true);
          const generation = subscriptionGenerations.get(op.key);
          const effects = previousEffects.then(() =>
            applyOperationCacheEffects(
              op,
              operationCacheEffects(result.data),
              () =>
                generation !== undefined &&
                subscriptionGenerations.get(op.key) === generation
            )
          );
          subscriptionEffectChains.set(op.key, effects);
          try {
            const cacheEffectsApplied = await effects;
            return withResultMetadata(result, {
              source: 'live-network',
              cacheEffectsApplied,
            });
          } finally {
            if (subscriptionEffectChains.get(op.key) === effects) {
              subscriptionEffectChains.delete(op.key);
            }
          }
        } else if (op.kind === 'query' && isHydrateOnly(op)) {
          if (predatesMutation(op)) {
            if (!result.hasNext && hydrationRequests.has(op.key)) {
              enqueueHydrationForward(op);
            }
            return undefined;
          }
          if (!result.hasNext) hydrationRequests.delete(op.key);
          if (result.error) return { ...result, data: undefined };
          if (result.data == null) return result;
          try {
            const hydration = await host.hydrateQuery({
              query: cacheQueryText(op),
              operationName: operationName(op),
              variables: op.variables as Record<string, unknown> | undefined,
              data: result.data,
              identity: options.extractIdentity?.(result.data),
              entityResolvers,
            });
            const deletion = await deleteReportedRecords(result);
            return withResultMetadata(
              {
                ...result,
                data: hydration.kind === 'data' ? hydration.data : undefined,
              },
              {
                source: 'live-network',
                revision: deletion?.revision ?? hydration.revision,
              }
            );
          } catch (error) {
            options.onCacheError?.(error, op);
            return {
              ...result,
              data: undefined,
              error: new CombinedError({
                networkError:
                  error instanceof Error ? error : new Error(String(error)),
              }),
            };
          }
        } else if (op.kind === 'query') {
          const state = queryState(op.key);
          if (predatesMutation(op)) {
            if (result.hasNext !== true) {
              state.networkRequestsInFlight = Math.max(
                0,
                state.networkRequestsInFlight - 1
              );
              refreshObsoleteQuery(op);
              finishNetworkQuery(op.key, state, false);
            }
            return undefined;
          }
          const version = ++state.networkResultVersion;
          if (result.hasNext !== true) {
            state.networkRequestsInFlight = Math.max(
              0,
              state.networkRequestsInFlight - 1
            );
          }
          state.networkError = result.error;
          // Publication, not persistence, supersedes an older cache snapshot.
          // A failed network request still permits a slower offline cache hit.
          if (result.data != null && !result.error) state.cacheReadVersion += 1;
          const persistence = persistQueryResult(result, state, version);
          return withResultMetadata(result, {
            source: 'live-network',
            persistence,
          });
        } else if (op.kind === 'mutation') {
          const attempt = queueAttemptOf(op);
          if (attempt) return await mutationQueue.settle(result, attempt);

          const optimistic = optimisticContextOf(op);
          if (result.data != null && !result.error) {
            await applyOperationCacheEffects(
              op,
              operationCacheEffects(result.data)
            );
            await deleteReportedRecords(result);
          }
          if (optimistic) {
            return withOptimisticMutationDisposition(result, {
              kind:
                result.data != null && !result.error
                  ? 'committed'
                  : 'permanently-failed',
            });
          }
        }
        return output;
      }

      const cacheResults$ = pipe(
        shared,
        filter((op) => op.kind === 'query'),
        mergeMap((op) => {
          if (!isHydrateOnly(op)) activeOps.set(op.key, op);
          return pipe(
            fromPromise(readThenRoute(op)),
            mergeMap((result) =>
              result ? fromValue(result) : (empty as Source<OperationResult>)
            )
          );
        })
      );

      // Optimistic mutations are held after durable enqueue until the strict
      // queue runner claims them. Operations behind the head emit a queued
      // disposition immediately; the head emits its network disposition.
      const mutationPrep$ = pipe(
        shared,
        filter((op) => op.kind === 'mutation'),
        mergeMap((op) =>
          pipe(
            fromPromise(prepareMutation(op)),
            mergeMap((result) =>
              result ? fromValue(result) : (empty as Source<OperationResult>)
            )
          )
        )
      );

      const passthrough$ = pipe(
        shared,
        filter((op) => op.kind !== 'query' && op.kind !== 'mutation'),
        tap((op) => {
          if (op.kind === 'subscription') {
            subscriptionGenerations.set(op.key, {});
          }
          if (op.kind === 'teardown') {
            hydrationRequests.delete(op.key);
            subscriptionGenerations.delete(op.key);
            activeOps.delete(op.key);
            liveQueries.delete(op.key);
            documentReader.forget(op.key);
            queryStates.delete(op.key);
            affectedRereads.forget(op.key);
            host.teardown(op.key).catch(() => undefined);
          }
        })
      );

      const forwarded$ = pipe(
        merge([forwardQueue$, passthrough$]),
        forward,
        mergeMap((result) => fromPromise(writeThrough(result))),
        filter((result): result is OperationResult => result !== undefined)
      );

      if (!host.disabled) {
        mutationQueue.start();
        // Includes BFCache restoration, even with no active query keys. The
        // host gates claims on initialization; durable leases still decide
        // which head is runnable after reconnecting.
        host.onCacheGenerationChanged((change) => {
          cacheGeneration += 1;
          if (change.storage === 'reset') mutationQueue.resetStorage();
          liveQueries.clear();
          documentReader.clear();
          mutationQueue.wake();
        });
        if (typeof addEventListener === 'function') {
          addEventListener('online', mutationQueue.wake);
        }
      }
      void unsubscribePush;
      return pipe(
        merge([affectedResults$, cacheResults$, mutationPrep$, forwarded$]),
        map((result) => {
          if (
            result.operation.kind !== 'query' ||
            isHydrateOnly(result.operation) ||
            !activeOps.has(result.operation.key)
          )
            return result;
          if (
            !isQueryObject(result.data) ||
            !supportsStoreReconciliation(result.data)
          ) {
            liveQueries.delete(result.operation.key);
            return result;
          }
          const current = liveQueries.get(result.operation.key);
          const view =
            current?.view ??
            new LiveQuery(result.data, queryShape(result.operation.query));
          if (current) view.replace(result.data);
          const liveResult = withLiveQueryData({ ...result }, view.data);
          liveQueries.set(result.operation.key, { view, result: liveResult });
          return liveResult;
        })
      );
    };
  };
}
