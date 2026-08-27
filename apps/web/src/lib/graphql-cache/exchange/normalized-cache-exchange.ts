/**
 * urql exchange backed by the normalized wasm cache (via a `CacheHost`).
 *
 * Differences from `@urql/exchange-graphcache`:
 * - cache reads are **async** (the cache is disk-backed, possibly in another
 *   worker/process), so operations needing the network are re-injected into
 *   the forward pipeline through a queue after the read resolves;
 * - invalidation is push-based: the host emits "these operation keys must
 *   re-execute" (local sibling writes, other tabs/webviews, external
 *   invalidations) and the exchange re-executes them as `cache-first`.
 *
 * Request policies:
 * - `cache-first` (default): hit → emit; miss → network.
 * - `cache-and-network`: hit → emit with `stale: true`, then network.
 *   (`toPromise()` ignores stale results, so imperative callers keep
 *   network-fresh semantics for free.)
 * - `network-only`: skip read; response still written to cache.
 * - `cache-only`: hit → emit; miss → emit `data: undefined`, no network.
 *
 * Mutations:
 * - With an optimistic response (see `executeOptimisticMutation`): the
 *   mutation and layer are durably queued before the ordered runner forwards
 *   it. Retryable failures retain optimism for background replay; permanent
 *   failures roll back. A caller whose operation is blocked behind the queue
 *   head receives a synthetic `queued` disposition instead of waiting.
 * - Without one: forwarded normally; successful responses are normalized
 *   through the standard write path so dependent cached queries update.
 *
 * Cache failures normally degrade to the network. An admitted optimistic
 * enqueue with an unfenced transport outcome emits an error instead, because
 * forwarding could duplicate a side effect already durable in the old scope.
 */

import {
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
  parse,
  visit,
} from 'graphql';
import { match } from 'ts-pattern';
import {
  empty,
  filter,
  fromPromise,
  fromValue,
  makeSubject,
  merge,
  mergeMap,
  pipe,
  type Source,
  share,
  tap,
} from 'wonka';
import type { CacheHost } from '../host/types';
import {
  type CacheRevision,
  type ClaimedMutation,
  type EnqueueOptimisticMutationResult,
  isAdmittedEnqueueUncertainError,
  isCacheRevision,
  isOwnerEpochLostError,
  type QueryRevalidationWire,
} from '../protocol';
import {
  compileEntityResolvers,
  type EntityResolverConfig,
} from './entity-resolvers';
import {
  normalizedEntityKey,
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from './optimistic';

/**
 * Private operation-context field carrying the optimistic transaction id
 * from forward time to result time. Lives on the operation (not keyed by
 * urql operation key): identical concurrent mutations share a key but each
 * carries its own transaction.
 */
const QUEUE_ATTEMPT_CONTEXT_KEY = 'normalizedCacheQueueAttempt';
/** Marks dependency-pushed reads as latency-sensitive worker work. */
const AFFECTED_READ_CONTEXT_KEY = 'normalizedCacheAffectedRead';
/** Prevents a replacement-registration cache read from forwarding the API again. */
const REPLACEMENT_REGISTRATION_ONLY_CONTEXT_KEY =
  'normalizedCacheReplacementRegistrationOnly';
/** Marks a query as network-to-cache hydration with a projected result. */
export const HYDRATE_ONLY_CONTEXT_KEY = 'normalizedCacheHydrateOnly';
/** Retains the client-annotated document while the transport uses a stripped copy. */
const HYDRATION_DOCUMENT_CONTEXT_KEY = 'normalizedCacheHydrationDocument';
const QUEUE_REQUEST_TIMEOUT_MS = 60_000;
const QUEUE_LEASE_MS = 5 * 60_000;
const EMPTY_QUEUE_POLL_MS = 30_000;

const NORMALIZED_CACHE_RESULT_METADATA_KEY = '__macroNormalizedCache';

/** Private authority metadata attached by the normalized-cache exchange. */
export type NormalizedCacheResultMetadata =
  | { source: 'live-network'; revision?: CacheRevision }
  | { source: 'normalized-cache-hit' }
  | { source: 'affected-cache-reread' };

/** Reads normalized-cache authority metadata from an urql operation result. */
export function normalizedCacheResultMetadata(
  result: Pick<OperationResult, 'extensions'>
): NormalizedCacheResultMetadata | undefined {
  const metadata = result.extensions?.[NORMALIZED_CACHE_RESULT_METADATA_KEY];
  if (metadata === null || typeof metadata !== 'object') return;
  const source = (metadata as { source?: unknown }).source;
  if (source === 'normalized-cache-hit' || source === 'affected-cache-reread') {
    return { source };
  }
  if (source !== 'live-network') return;
  const revision = (metadata as { revision?: unknown }).revision;
  return isCacheRevision(revision) ? { source, revision } : { source };
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

type QueueAttemptContext = {
  transactionId: string;
  leaseOwner: string;
  leaseGeneration: string;
  attemptCount: number;
};

function queueAttemptOf(op: Operation): QueueAttemptContext | undefined {
  const value: unknown = op.context[QUEUE_ATTEMPT_CONTEXT_KEY];
  if (
    value !== null &&
    typeof value === 'object' &&
    'transactionId' in value &&
    'leaseOwner' in value &&
    'leaseGeneration' in value
  ) {
    return value as QueueAttemptContext;
  }
  return undefined;
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
      [HYDRATION_DOCUMENT_CONTEXT_KEY]: op.query,
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

function replayDocument(query: string, name?: string): DocumentNode {
  const document = parse(query);
  if (!name) return document;
  const definitions = document.definitions.filter(
    (definition) =>
      definition.kind !== Kind.OPERATION_DEFINITION ||
      definition.name?.value === name
  );
  if (
    !definitions.some(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION
    )
  ) {
    throw new Error(`queued GraphQL operation ${name} is missing`);
  }
  return { ...document, definitions };
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptCount - 1), 60_000);
}

/** Applies a hard network bound well inside the durable queue lease. */
function withQueueRequestTimeout(op: Operation): Operation {
  const operationFetch = op.context.fetch ?? globalThis.fetch;
  return makeOperation(op.kind, op, {
    ...op.context,
    fetch: (input, init) => {
      const timeoutSignal = AbortSignal.timeout(QUEUE_REQUEST_TIMEOUT_MS);
      return operationFetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal,
      });
    },
  });
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

function queuedMutationResult(
  op: Operation,
  transactionId: string
): OperationResult {
  return withOptimisticMutationDisposition(
    {
      operation: op,
      data: optimisticContextOf(op)?.optimisticResponse,
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    },
    { kind: 'queued', transactionId }
  );
}

export interface NormalizedCacheExchangeOptions {
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
      networkBoundQueries: number;
      replacementFallback: boolean;
      deferredAffected: boolean;
      completedReplacementFallback: boolean;
      networkRegistrationSatisfied: boolean;
      retainedReplacementFallback?: RetainedReplacementFallback;
      networkResultVersion: number;
      queryResultTurn?: Promise<void>;
    };
    const queryStates = new Map<number, QueryState>();
    const queryState = (key: number): QueryState => {
      let state = queryStates.get(key);
      if (!state) {
        state = {
          networkBoundQueries: 0,
          replacementFallback: false,
          deferredAffected: false,
          completedReplacementFallback: false,
          networkRegistrationSatisfied: false,
          networkResultVersion: 0,
        };
        queryStates.set(key, state);
      }
      return state;
    };

    const acquireQueryResultTurn = async (key: number): Promise<() => void> => {
      const state = queryState(key);
      const previous = state.queryResultTurn ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.queryResultTurn = current;
      await previous;
      return () => {
        release();
        if (
          queryStates.get(key) === state &&
          state.queryResultTurn === current
        ) {
          state.queryResultTurn = undefined;
        }
      };
    };

    const invalidateOlderRetainedFallback = async (
      key: number,
      version: number
    ): Promise<void> => {
      while (true) {
        const state = queryStates.get(key);
        const retained = state?.retainedReplacementFallback;
        if (!state || !retained || retained.version >= version) return;
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

    const emitAffectedWhileNetworkBound = (key: number): void => {
      const operation = activeOps.get(key);
      if (!operation) return;
      void host
        .readQuery({
          opKey: operation.key,
          query: queryText(operation),
          operationName: operationName(operation),
          variables: operation.variables as Record<string, unknown> | undefined,
          priority: 'user-visible',
          entityResolvers,
        })
        .then((read) => {
          const active = activeOps.get(key);
          if (read.kind !== 'hit' || !active) return;
          // Preserve the authoritative request while immediately surfacing the
          // newer local view. Its eventual result still gets the deferred
          // cache reread below when it could not register fresh dependencies.
          emitAffectedResult(
            cacheResult(active, read.data, true, 'affected-cache-reread')
          );
        })
        .catch((error) => options.onCacheError?.(error, operation));
    };

    const unsubscribePush = host.onOpsAffected((opKeys) => {
      for (const key of opKeys) {
        if (!activeOps.has(key)) continue;
        const state = queryState(key);
        if (state.networkBoundQueries > 0) {
          state.deferredAffected = true;
          if (
            !state.replacementFallback &&
            !state.retainedReplacementFallback
          ) {
            emitAffectedWhileNetworkBound(key);
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
        reexecuteAffected(key, registrationOnly);
      }
    });

    return (ops$) => {
      const shared = pipe(ops$, share);

      // Async cache reads re-inject network-bound operations here.
      const { source: forwardQueue$, next: enqueueForward } =
        makeSubject<Operation>();

      const enqueueQueryForward = (op: Operation): void => {
        queryState(op.key).networkBoundQueries += 1;
        enqueueForward(op);
      };

      const finishNetworkQuery = (
        key: number,
        replacementRegistrationSatisfied: boolean
      ): void => {
        const state = queryState(key);
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
            } else {
              reexecuteAffected(key, true);
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
      const liveQueuedOps = new Map<
        string,
        {
          operation: Operation;
          resolveRoute: (result: OperationResult | undefined) => void;
        }
      >();
      const subscriptionEffectChains = new Map<number, Promise<void>>();
      let attemptInFlight = false;
      let drainRunning = false;
      let deferredUntil: number | undefined;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;

      function scheduleDrain(delayMs = 0): void {
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        drainTimer = setTimeout(() => {
          drainTimer = undefined;
          void drainQueue();
        }, delayMs);
      }

      function resolveLiveOperationsAsQueued(): void {
        for (const [transactionId, live] of liveQueuedOps) {
          liveQueuedOps.delete(transactionId);
          live.resolveRoute(
            queuedMutationResult(live.operation, transactionId)
          );
        }
      }

      /** Routes one already-leased strict queue head to the network. */
      async function routeClaimedMutation(
        claimed: ClaimedMutation
      ): Promise<void> {
        deferredUntil = undefined;
        attemptInFlight = true;
        const attempt: QueueAttemptContext = {
          transactionId: claimed.transactionId,
          leaseOwner: queueOwner,
          leaseGeneration: claimed.leaseGeneration,
          attemptCount: claimed.attemptCount,
        };
        const live = liveQueuedOps.get(claimed.transactionId);
        if (live) {
          liveQueuedOps.delete(claimed.transactionId);
          live.resolveRoute(undefined);
          enqueueForward(
            withQueueRequestTimeout(
              makeOperation(live.operation.kind, live.operation, {
                ...live.operation.context,
                [QUEUE_ATTEMPT_CONTEXT_KEY]: attempt,
              })
            )
          );
        } else {
          try {
            const replay = client.mutation(
              replayDocument(claimed.query, claimed.operationName),
              claimed.variables,
              {
                requestPolicy: 'network-only',
                [QUEUE_ATTEMPT_CONTEXT_KEY]: attempt,
              }
            );
            await replay.toPromise().then((result) => {
              // Normal exchange results settle the attempt in writeThrough
              // before resolving. Reject only an otherwise-unhandled error.
              if (result.error && attemptInFlight) {
                return Promise.reject(result.error);
              }
            });
          } catch (error) {
            try {
              await host.rollbackOptimisticWrite(
                claimed.transactionId,
                {
                  owner: queueOwner,
                  generation: claimed.leaseGeneration,
                },
                error instanceof Error ? error.message : String(error)
              );
            } finally {
              attemptInFlight = false;
              scheduleDrain();
            }
          }
        }
        // Any other live operation is ordered behind the claimed head.
        resolveLiveOperationsAsQueued();
      }

      async function drainQueue(): Promise<void> {
        if (attemptInFlight) {
          // Every newly enqueued operation is behind the claimed head. Its
          // caller can stop waiting; durable replay now owns the mutation.
          resolveLiveOperationsAsQueued();
          return;
        }
        if (drainRunning) return;
        drainRunning = true;
        try {
          const now = Date.now();
          const claimed = await host.claimNextMutation(
            queueOwner,
            now,
            now + QUEUE_LEASE_MS
          );
          if (!claimed) {
            resolveLiveOperationsAsQueued();
            scheduleDrain(
              deferredUntil === undefined
                ? EMPTY_QUEUE_POLL_MS
                : Math.max(0, deferredUntil - Date.now())
            );
            return;
          }

          await routeClaimedMutation(claimed);
        } catch {
          // Enqueue already succeeded, so callers must observe these as
          // queued even if the runner cannot currently inspect the head.
          resolveLiveOperationsAsQueued();
          scheduleDrain(EMPTY_QUEUE_POLL_MS);
        } finally {
          drainRunning = false;
        }
      }

      function revalidateAfterCommit(
        revalidations: QueryRevalidationWire[],
        mutation: Operation
      ): void {
        for (const revalidation of revalidations) {
          try {
            const variables: unknown = JSON.parse(revalidation.variablesJson);
            if (
              variables === null ||
              typeof variables !== 'object' ||
              Array.isArray(variables)
            ) {
              throw new Error('cache revalidation variables are not an object');
            }
            void client
              .query(
                replayDocument(revalidation.query, revalidation.operationName),
                variables as Record<string, unknown>,
                { requestPolicy: 'network-only' }
              )
              .toPromise()
              .then((result) => {
                if (result.error) throw result.error;
              })
              .catch((error) => options.onCacheError?.(error, mutation));
          } catch (error) {
            options.onCacheError?.(error, mutation);
          }
        }
      }

      async function readThenRoute(
        op: Operation
      ): Promise<OperationResult | undefined> {
        if (isHydrateOnly(op)) {
          enqueueForward(hydrationTransportOperation(op));
          return undefined;
        }
        const policy = op.context.requestPolicy;
        if (policy === 'network-only') {
          enqueueQueryForward(op);
          return undefined;
        }
        try {
          const read = await host.readQuery({
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
          if (read.kind === 'hit') {
            const stale = policy === 'cache-and-network';
            if (stale) enqueueQueryForward(op);
            return cacheResult(op, read.data, stale);
          }
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        } catch (error) {
          options.onCacheError?.(error, op);
          if (isOwnerEpochLostError(error)) {
            queryState(op.key).replacementFallback = true;
          }
          // `cache-only` must never touch the network, even when the cache
          // itself fails — degrade to an empty result instead.
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        }
        if (op.context[REPLACEMENT_REGISTRATION_ONLY_CONTEXT_KEY] === true) {
          return undefined;
        }
        enqueueQueryForward(op);
        return undefined;
      }

      /** Durably queues optimism before allowing the ordered runner to send. */
      async function prepareMutation(
        op: Operation
      ): Promise<OperationResult | undefined> {
        if (host.disabled) {
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
          query: queryText(op),
          operationName: operationName(op),
          variables: op.variables as Record<string, unknown> | undefined,
          data: optimistic.optimisticResponse,
          linkPatches: optimistic.linkPatches,
          revalidations: optimistic.revalidations,
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
          options.onCacheError?.(error, op);
          if (isAdmittedEnqueueUncertainError(error)) {
            // The old-scope queue may already contain the side effect. It is
            // unsafe to forward or retry without a coordinator fence.
            return uncertainEnqueueResult(op, error);
          }
          // A cached bin/page may disappear between inspect and enqueue. Do
          // not expose a partial relation move: retain entity optimism and
          // the post-success revalidation descriptors instead.
          if (args.linkPatches.length === 0) {
            enqueueForward(op);
            return undefined;
          }
          try {
            enqueue = await host.enqueueOptimisticMutation(
              {
                ...args,
                linkPatches: [],
                revalidations: [
                  ...args.revalidations,
                  ...args.linkPatches.map((patch) => ({
                    query: patch.query,
                    operationName: patch.operationName,
                    variablesJson: patch.variablesJson,
                  })),
                ],
              },
              claim
            );
          } catch (fallbackError) {
            options.onCacheError?.(fallbackError, op);
            if (isAdmittedEnqueueUncertainError(fallbackError)) {
              return uncertainEnqueueResult(op, fallbackError);
            }
            enqueueForward(op);
            return undefined;
          }
        }
        const routed = new Promise<OperationResult | undefined>((resolve) => {
          liveQueuedOps.set(enqueue.transactionId, {
            operation: op,
            resolveRoute: resolve,
          });
        });
        try {
          await match(enqueue.initialClaim)
            .with({ kind: 'claimed' }, ({ mutation }) =>
              routeClaimedMutation(mutation)
            )
            .with({ kind: 'not-runnable' }, () => {
              resolveLiveOperationsAsQueued();
              scheduleDrain();
            })
            .with({ kind: 'failed' }, ({ error }) => {
              options.onCacheError?.(new Error(error), op);
              resolveLiveOperationsAsQueued();
              scheduleDrain(EMPTY_QUEUE_POLL_MS);
            })
            .exhaustive();
        } catch (error) {
          // Enqueue already succeeded. Preserve durable-runner ownership even
          // if routing or claim rollback fails unexpectedly.
          options.onCacheError?.(error, op);
          resolveLiveOperationsAsQueued();
          scheduleDrain(EMPTY_QUEUE_POLL_MS);
        }
        return await routed;
      }

      /** Applies operation cache effects serially and isolates every failure. */
      async function applyOperationCacheEffects(
        op: Operation,
        effects: CacheEffect[]
      ): Promise<void> {
        for (const effect of effects) {
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
            // One failed cache effect must neither skip later effects nor
            // prevent delivery of the original operation result.
            options.onCacheError?.(error, op);
          }
        }
      }

      async function writeThrough(
        result: OperationResult
      ): Promise<OperationResult> {
        const op = result.operation;
        let output =
          op.kind === 'query'
            ? withResultMetadata(result, { source: 'live-network' })
            : result;
        if (op.kind === 'subscription' && result.data != null) {
          // Serialize effects across every emission for this operation, as
          // well as within buffered payloads, so a slower earlier write cannot
          // overtake a later delete. Subscribers still receive each original
          // result after its effects settle.
          const previousEffects =
            subscriptionEffectChains.get(op.key) ?? Promise.resolve();
          const effects = previousEffects.then(() =>
            applyOperationCacheEffects(op, operationCacheEffects(result.data))
          );
          subscriptionEffectChains.set(op.key, effects);
          try {
            await effects;
          } finally {
            if (subscriptionEffectChains.get(op.key) === effects) {
              subscriptionEffectChains.delete(op.key);
            }
          }
        } else if (op.kind === 'query' && isHydrateOnly(op)) {
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
            return withResultMetadata(
              {
                ...result,
                data: hydration.kind === 'data' ? hydration.data : undefined,
              },
              { source: 'live-network', revision: hydration.revision }
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
          const releaseTurn = await acquireQueryResultTurn(op.key);
          try {
            const state = queryState(op.key);
            const resultVersion = state.networkResultVersion + 1;
            state.networkResultVersion = resultVersion;
            // Every newer result supersedes an older retained payload, even an
            // error or intermediate streamed result with no cache write.
            await invalidateOlderRetainedFallback(op.key, resultVersion);
            if (result.data != null) {
              const readArgs = {
                opKey: op.key,
                query: queryText(op),
                operationName: operationName(op),
                variables: op.variables as Record<string, unknown> | undefined,
                entityResolvers,
              };
              const writeArgs = {
                ...readArgs,
                data: result.data,
                identity: options.extractIdentity?.(result.data),
                registerDependencies: activeOps.has(op.key),
              };
              const retained: RetainedReplacementFallback | undefined =
                result.error === undefined &&
                result.hasNext !== true &&
                activeOps.has(op.key) &&
                state.replacementFallback
                  ? {
                      version: resultVersion,
                      writeArgs,
                      readyPending: false,
                      recovering: false,
                      invalidated: false,
                    }
                  : undefined;
              if (retained) {
                // Install before the first write: replacement-ready pushes can
                // arrive synchronously while the cache attempt is settling.
                state.retainedReplacementFallback = retained;
              }
              try {
                const write = await host.writeQuery(writeArgs);
                output = withResultMetadata(result, {
                  source: 'live-network',
                  revision: write.revision,
                });
                state.networkRegistrationSatisfied =
                  writeArgs.registerDependencies;
                if (state.retainedReplacementFallback === retained) {
                  state.retainedReplacementFallback = undefined;
                }
              } catch (error) {
                options.onCacheError?.(error, op);
              }
            }
            if (result.hasNext !== true) {
              const registrationSatisfied = state.networkRegistrationSatisfied;
              state.networkRegistrationSatisfied = false;
              finishNetworkQuery(op.key, registrationSatisfied);
            }
          } finally {
            if (!activeOps.has(op.key)) queryStates.delete(op.key);
            releaseTurn();
          }
        } else if (op.kind === 'mutation') {
          const attempt = queueAttemptOf(op);
          if (attempt) {
            const claim = {
              owner: attempt.leaseOwner,
              generation: attempt.leaseGeneration,
            };
            let retryAt: number | undefined;
            let disposition: 'committed' | 'queued' | 'permanently-failed' =
              'queued';
            try {
              if (result.error || result.data == null) {
                let retry = false;
                if (result.error && options.shouldRetryMutation) {
                  try {
                    retry = await options.shouldRetryMutation(result.error);
                  } catch (error) {
                    options.onCacheError?.(error, op);
                  }
                }
                if (retry) {
                  retryAt = Date.now() + retryDelayMs(attempt.attemptCount);
                  await host.deferOptimisticWrite(
                    attempt.transactionId,
                    claim,
                    retryAt,
                    result.error?.message ?? 'mutation returned no data'
                  );
                  disposition = 'queued';
                } else {
                  await host.rollbackOptimisticWrite(
                    attempt.transactionId,
                    claim,
                    result.error?.message ?? 'mutation returned no data'
                  );
                  disposition = 'permanently-failed';
                }
              } else {
                const committed = await host.commitOptimisticWrite(
                  attempt.transactionId,
                  claim,
                  {
                    query: queryText(op),
                    operationName: operationName(op),
                    variables: op.variables as
                      | Record<string, unknown>
                      | undefined,
                    data: result.data,
                  }
                );
                const effects = operationCacheEffects(result.data);
                if (effects.some((effect) => effect.kind === 'delete')) {
                  // Commit already normalized the complete result. Replay only
                  // mixed explicit effects so their final write/delete order is
                  // identical to a non-optimistic operation.
                  await applyOperationCacheEffects(op, effects);
                }
                revalidateAfterCommit(committed.revalidations ?? [], op);
                disposition = 'committed';
              }
            } catch (error) {
              options.onCacheError?.(error, op);
              retryAt = Date.now() + QUEUE_LEASE_MS;
              // The durable transaction may still exist (or the settlement
              // may have completed despite a lost response). Never tell the
              // caller to roll back while settlement is uncertain.
              disposition = 'queued';
            } finally {
              liveQueuedOps.delete(attempt.transactionId);
              attemptInFlight = false;
              deferredUntil = retryAt;
              scheduleDrain(
                retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now())
              );
            }
            return withOptimisticMutationDisposition(result, {
              kind: disposition,
              transactionId: attempt.transactionId,
            });
          }

          const optimistic = optimisticContextOf(op);
          if (result.data != null && !result.error) {
            await applyOperationCacheEffects(
              op,
              operationCacheEffects(result.data)
            );
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
          if (op.kind === 'teardown') {
            activeOps.delete(op.key);
            queryStates.delete(op.key);
            host.teardown(op.key).catch(() => undefined);
          }
        })
      );

      const forwarded$ = pipe(
        merge([forwardQueue$, passthrough$]),
        forward,
        mergeMap((result) => fromPromise(writeThrough(result)))
      );

      if (!host.disabled) {
        scheduleDrain();
        if (typeof addEventListener === 'function') {
          addEventListener('online', () => scheduleDrain());
        }
      }
      void unsubscribePush;
      return merge([
        affectedResults$,
        cacheResults$,
        mutationPrep$,
        forwarded$,
      ]);
    };
  };
}
