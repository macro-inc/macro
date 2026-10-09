/**
 * Strict runner for the durable optimistic mutation queue.
 *
 * The cache worker owns the queue; this runner claims its head, decides how
 * to send it, and settles the outcome. Two pieces of state drive it:
 *
 * - The pump (`drainQueue`) runs on a timer, `online`, or cache restore and
 *   claims the next runnable head while no attempt is active. A durable
 *   enqueue may also claim its own head immediately (`admit`).
 * - The head machine tracks the claimed attempt:
 *
 *       idle | confirmed-unsettled
 *         │ claim
 *         ├─ same head as confirmed ──▶ settling (re-apply; never resend)
 *         ▼
 *       preparing ── superseded discard ──▶ idle
 *         │       └─ veto or recovery failure ──▶ settling
 *         ▼
 *       in-flight ── replay rejected unsettled ──▶ settling
 *         ▼
 *       settling ──▶ idle, or confirmed-unsettled when the server
 *                    confirmed the head but its local commit failed
 *
 * Every attempt carries a token: the storage generation it was claimed in plus
 * its lease owner and generation. The lease fences durable writes in the
 * worker; the storage generation fences this runner. A storage reset bumps
 * the generation and returns the head to idle, which retires every token.
 * Head changes go through `transition`, which checks the token, and each
 * awaited step rechecks `isCurrent` before it acts. Releasing live callers as
 * queued and scheduling the pump are idempotent wakeups and are not fenced.
 */

import {
  type Client,
  CombinedError,
  createRequest,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { type DocumentNode, Kind, parse } from 'graphql';
import { match } from 'ts-pattern';
import type { CacheHost } from '../host/types';
import type {
  ClaimedMutation,
  EnqueueOptimisticMutationResult,
  MutationClaim,
  QueryRevalidationWire,
} from '../protocol';
import type { NormalizedCacheExchangeOptions } from './normalized-cache-exchange';
import {
  notifyOptimisticMutationEnqueued,
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
export const QUEUE_REQUEST_TIMEOUT_MS = 60_000;
export const QUEUE_LEASE_MS = 5 * 60_000;
const EMPTY_QUEUE_POLL_MS = 30_000;
const MAX_MUTATION_SERVER_FAILURES = 10;
const MUTATION_LIFECYCLE_TIMEOUT_MS = 2_000;

async function boundedMutationLifecycle<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Mutation recovery timed out')),
          MUTATION_LIFECYCLE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Storage generation captured when work starts; a reset retires it. */
export type StorageEpoch = { storageGeneration: number };

/** Fences one claimed attempt in this runner and in the durable queue. */
type AttemptToken = StorageEpoch & {
  transactionId: string;
  leaseOwner: string;
  leaseGeneration: string;
};

export type QueueAttemptContext = AttemptToken & {
  mutation?: ClaimedMutation;
  attemptCount: number;
  serverFailureCount: number;
  /** Transport-only metadata; urql drops the response on error-free payloads. */
  response?: Response;
};

function claimOf(token: AttemptToken): MutationClaim {
  return { owner: token.leaseOwner, generation: token.leaseGeneration };
}

export function queueAttemptOf(op: Operation): QueueAttemptContext | undefined {
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

function withQueueAttempt(
  op: Operation,
  attempt: QueueAttemptContext
): Operation {
  return makeOperation(op.kind, op, {
    ...op.context,
    [QUEUE_ATTEMPT_CONTEXT_KEY]: attempt,
  });
}

export function replayDocument(query: string, name?: string): DocumentNode {
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

/** Bounds network time inside the lease and retains HTTP status for settlement. */
export function withQueueRequestTimeout(op: Operation): Operation {
  const operationFetch = op.context.fetch ?? globalThis.fetch;
  const attempt = queueAttemptOf(op);
  return makeOperation(op.kind, op, {
    ...op.context,
    fetch: async (input, init) => {
      const timeoutSignal = AbortSignal.timeout(QUEUE_REQUEST_TIMEOUT_MS);
      const response = await operationFetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal,
      });
      if (attempt) attempt.response = response;
      return response;
    },
  });
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

/** Only an authoritative GraphQL rejection carries a domain failure code. */
function mutationErrorCode(
  error: CombinedError | undefined
): string | undefined {
  if (error?.networkError) return;
  const code = error?.graphQLErrors[0]?.extensions.code;
  return typeof code === 'string' ? code : undefined;
}

/** Server response kept until its local commit succeeds. */
type ConfirmedMutation = { transactionId: string; result: OperationResult };

/** Phase of the claimed queue head; at most one attempt is active. */
type HeadState =
  | { kind: 'idle' }
  /** The server confirmed this head but its local commit failed. */
  | { kind: 'confirmed-unsettled'; confirmed: ConfirmedMutation }
  /** Startup recovery and `beforeMutationAttempt` admission. */
  | { kind: 'preparing' }
  /** Forwarded by its live caller or replayed from durable data. */
  | { kind: 'in-flight' }
  /** Writing the attempt's durable outcome. */
  | { kind: 'settling'; confirmed?: ConfirmedMutation };

const IDLE: HeadState = { kind: 'idle' };
const PREPARING: HeadState = { kind: 'preparing' };
const IN_FLIGHT: HeadState = { kind: 'in-flight' };
const SETTLING: HeadState = { kind: 'settling' };

/** An active attempt holds the head; the pump must not claim another. */
function isActive(head: HeadState): boolean {
  return match(head.kind)
    .with('preparing', 'in-flight', 'settling', () => true)
    .with('idle', 'confirmed-unsettled', () => false)
    .exhaustive();
}

function confirmedOf(head: HeadState): ConfirmedMutation | undefined {
  return head.kind === 'confirmed-unsettled' || head.kind === 'settling'
    ? head.confirmed
    : undefined;
}

/** A network result for the in-flight head starts its settlement. */
function receiveResult(head: HeadState): HeadState {
  return head.kind === 'in-flight' ? SETTLING : head;
}

function confirm(confirmed: ConfirmedMutation) {
  return (head: HeadState): HeadState =>
    isActive(head)
      ? { kind: 'settling', confirmed }
      : { kind: 'confirmed-unsettled', confirmed };
}

function forgetConfirmed(head: HeadState): HeadState {
  if (head.kind === 'confirmed-unsettled') return IDLE;
  return head.kind === 'settling' ? SETTLING : head;
}

/** Releases the head; an unapplied server confirmation stays pinned. */
function release(head: HeadState): HeadState {
  const confirmed = confirmedOf(head);
  return confirmed ? { kind: 'confirmed-unsettled', confirmed } : IDLE;
}

type LiveQueuedOperation = {
  operation: Operation;
  resolveRoute: (result: OperationResult | undefined) => void;
};

export type MutationQueueRunnerDeps = {
  host: CacheHost;
  client: Client;
  options: Pick<
    NormalizedCacheExchangeOptions,
    | 'prepareMutationQueue'
    | 'beforeMutationAttempt'
    | 'onMutationAttemptResult'
    | 'shouldRetryMutation'
    | 'onCacheError'
  >;
  /** Lease owner for this exchange's claims. */
  owner: string;
  /** Sends an operation down the exchange's network stream. */
  forward: (op: Operation) => void;
  /** Delivers a result through the exchange's normal write path. */
  writeThrough: (
    result: OperationResult
  ) => Promise<OperationResult | undefined>;
  /** Query text and variables the cache normalizes `op`'s data against. */
  cacheDocument: (op: Operation) => {
    query: string;
    operationName?: string;
    variables?: Record<string, unknown>;
  };
  /** Evicts records a successful response implies were deleted. */
  deleteReportedRecords: (result: OperationResult) => Promise<unknown>;
  /**
   * Replays explicit deletions mixed into a committed response, in order.
   * Undefined when there is nothing to replay, so settlement does not yield.
   */
  replayExplicitEffects: (
    op: Operation,
    data: unknown,
    isCurrent: () => boolean
  ) => Promise<unknown> | undefined;
  /** Refreshes queries a settled mutation could not update in place. */
  revalidate: (
    revalidations: QueryRevalidationWire[],
    mutation?: Operation
  ) => Promise<void>;
};

/** The exchange's view of the queue runner. */
export type MutationQueueRunner = {
  /** Captures the storage epoch an enqueue starts in. */
  epoch: () => StorageEpoch;
  /** False once a storage reset has retired `epoch`. */
  isCurrent: (epoch: StorageEpoch) => boolean;
  /** Holds a durably enqueued caller until the strict queue routes it. */
  admit: (
    op: Operation,
    enqueue: EnqueueOptimisticMutationResult,
    epoch: StorageEpoch
  ) => Promise<OperationResult | undefined>;
  /** Settles a queue attempt's network result. */
  settle: (
    result: OperationResult,
    attempt: QueueAttemptContext
  ) => Promise<OperationResult>;
  /** Schedules the first drain. */
  start: () => void;
  /** Probes the queue now, keeping the request until a claim can run. */
  wake: () => void;
  /** Retires every attempt token and returns the head to idle. */
  resetStorage: () => void;
};

export function createMutationQueueRunner(
  deps: MutationQueueRunnerDeps
): MutationQueueRunner {
  const { host, client, options, owner, forward, writeThrough } = deps;
  const liveQueuedOps = new Map<string, LiveQueuedOperation>();
  let storageGeneration = 0;
  // The durable queue is strictly ordered. A confirmed head keeps its server
  // response until local settlement succeeds, without repeating a server
  // effect after a cache failure. Process loss still requires server-side
  // idempotency to make replay safe across runners.
  let head: HeadState = IDLE;
  // Pump state: wakeups and the retry hint are independent of the head.
  let queuePreparation: Promise<void> | undefined;
  let drainRunning = false;
  let drainRequested = false;
  let deferredUntil: number | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  function isCurrent(token: StorageEpoch): boolean {
    return token.storageGeneration === storageGeneration;
  }

  /** Moves the head only while `token` has survived every storage reset. */
  function transition(
    token: StorageEpoch,
    next: HeadState | ((head: HeadState) => HeadState)
  ): boolean {
    if (!isCurrent(token)) return false;
    head = typeof next === 'function' ? next(head) : next;
    return true;
  }

  function scheduleDrain(delayMs = 0): void {
    if (drainTimer !== undefined) clearTimeout(drainTimer);
    drainTimer = setTimeout(
      () => {
        drainTimer = undefined;
        void drainQueue();
      },
      drainRequested ? 0 : delayMs
    );
  }

  function wakeDrain(): void {
    // Keep the wakeup until the runner can claim again. An interrupted
    // claim/settlement may still be unwinding and scheduling its backoff.
    drainRequested = true;
    scheduleDrain();
  }

  function resolveLiveOperationsAsQueued(): void {
    for (const [transactionId, live] of liveQueuedOps) {
      liveQueuedOps.delete(transactionId);
      live.resolveRoute(queuedMutationResult(live.operation, transactionId));
    }
  }

  /**
   * Routes one leased queue head to local settlement or the network. Await
   * points match the pre-extraction runner: forwarding a live caller must
   * stay synchronous with its claim, or callers behind it would be released.
   */
  async function routeClaimedMutation(
    claimed: ClaimedMutation,
    epoch: StorageEpoch
  ): Promise<void> {
    const attempt: QueueAttemptContext = {
      mutation: claimed,
      transactionId: claimed.transactionId,
      leaseOwner: owner,
      leaseGeneration: claimed.leaseGeneration,
      attemptCount: claimed.attemptCount,
      serverFailureCount: claimed.serverFailureCount ?? 0,
      storageGeneration: epoch.storageGeneration,
    };
    const confirmed = confirmedOf(head);
    if (confirmed?.transactionId === claimed.transactionId) {
      // claim → settling: re-apply the server's response before admission
      // hooks run, so they can never veto or resend a confirmed head.
      if (!transition(attempt, { kind: 'settling', confirmed })) return;
      deferredUntil = undefined;
      await writeThrough({
        ...confirmed.result,
        operation: withQueueAttempt(confirmed.result.operation, attempt),
      });
      resolveLiveOperationsAsQueued();
      return;
    }
    // claim → preparing. Claiming another head proves the previous one was
    // removed, including settlement by another runner or a storage reset.
    if (!transition(attempt, PREPARING)) return;
    try {
      if (options.prepareMutationQueue) await prepareQueueRecovery();
      if (
        options.beforeMutationAttempt &&
        !(await boundedMutationLifecycle(() =>
          options.beforeMutationAttempt!(claimed)
        ))
      ) {
        // preparing → settling → idle: discard obsolete local intent.
        if (!transition(attempt, SETTLING)) return;
        await host.rollbackOptimisticWrite(
          claimed.transactionId,
          claimOf(attempt),
          'Obsolete local intent',
          'LOCAL_SUPERSEDED'
        );
        if (!transition(attempt, IDLE)) return;
        resolveLiveOperationsAsQueued();
        scheduleDrain();
        return;
      }
    } catch {
      await failPreparation(claimed, attempt);
      return;
    }
    // A superseded create can already exist on the server. Replay it to
    // recover its identity before sending the newer edit or discard.
    // Older hosts omit this flag: conservatively replay rather than loop
    // forever asking the engine to discard a write it must retain.
    const discard =
      claimed.superseded && claimed.requiresConfirmation === false;
    // preparing → idle (discard) or in-flight (send).
    if (!transition(attempt, discard ? IDLE : IN_FLIGHT)) return;
    deferredUntil = undefined;
    if (discard) {
      const discarded = await host.deferOptimisticWrite(
        claimed.transactionId,
        claimOf(attempt),
        Date.now(),
        'superseded before network replay'
      );
      if (discarded.kind !== 'discarded-superseded') {
        throw new Error('superseded mutation was unexpectedly deferred');
      }
      const live = liveQueuedOps.get(claimed.transactionId);
      if (live) {
        liveQueuedOps.delete(claimed.transactionId);
        live.resolveRoute(
          queuedMutationResult(live.operation, claimed.transactionId)
        );
      }
      resolveLiveOperationsAsQueued();
      scheduleDrain();
      return;
    }
    const live = liveQueuedOps.get(claimed.transactionId);
    if (live) {
      liveQueuedOps.delete(claimed.transactionId);
      live.resolveRoute(undefined);
      forward(
        withQueueRequestTimeout(withQueueAttempt(live.operation, attempt))
      );
    } else {
      let replayOperation: Operation | undefined;
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
          replayOperation = result.operation;
          // Normal exchange results settle the attempt in writeThrough
          // before resolving. Reject only an otherwise-unhandled error.
          if (result.error && isActive(head)) {
            return Promise.reject(result.error);
          }
        });
      } catch (error) {
        try {
          // in-flight → settling → idle: the replay never reached settlement.
          if (!transition(attempt, SETTLING)) return;
          const rolledBack = await host.rollbackOptimisticWrite(
            claimed.transactionId,
            claimOf(attempt),
            error instanceof Error ? error.message : String(error),
            error instanceof CombinedError
              ? mutationErrorCode(error)
              : undefined
          );
          if (!isCurrent(attempt)) return;
          if (rolledBack.kind === 'rolled-back') {
            void deps.revalidate(
              rolledBack.revalidations ?? [],
              replayOperation
            );
          }
        } finally {
          if (transition(attempt, IDLE)) scheduleDrain();
        }
      }
    }
    // Any other live operation is ordered behind the claimed head.
    resolveLiveOperationsAsQueued();
  }

  /** preparing → settling → idle for a head whose recovery state failed. */
  async function failPreparation(
    claimed: ClaimedMutation,
    attempt: QueueAttemptContext
  ): Promise<void> {
    queuePreparation = undefined;
    try {
      if (!transition(attempt, SETTLING)) return;
      const live = liveQueuedOps.get(claimed.transactionId);
      const operation =
        live?.operation ??
        makeOperation(
          'mutation',
          createRequest(
            replayDocument(claimed.query, claimed.operationName),
            claimed.variables
          ),
          { url: '', requestPolicy: 'network-only' }
        );
      const failure = new CombinedError({
        graphQLErrors: [
          {
            message: 'Unable to prepare the saved mutation for replay',
            extensions: { code: 'LOCAL_RECOVERY_FAILED' },
          },
        ],
      });
      const result: OperationResult = {
        operation,
        data: undefined,
        error: failure,
        stale: false,
        hasNext: false,
      };
      await recordAttemptResult(attempt, result, false);
      // Known gap: unlike every other settlement step, this rollback and the
      // bookkeeping after it do not recheck the token. A storage reset during
      // the recovery hook lets this stale attempt roll back a replacement
      // queue head that reuses its transaction id and lease generation.
      await host.rollbackOptimisticWrite(
        claimed.transactionId,
        claimOf(attempt),
        failure.message,
        'LOCAL_RECOVERY_FAILED'
      );
      liveQueuedOps.delete(claimed.transactionId);
      live?.resolveRoute(
        withOptimisticMutationDisposition(result, {
          kind: 'permanently-failed',
          transactionId: claimed.transactionId,
        })
      );
      deferredUntil = undefined;
    } finally {
      if (transition(attempt, IDLE)) {
        resolveLiveOperationsAsQueued();
        scheduleDrain();
      }
    }
  }

  async function drainQueue(): Promise<void> {
    if (isActive(head)) {
      // Every newly enqueued operation is behind the claimed head. Its
      // caller can stop waiting; durable replay now owns the mutation.
      resolveLiveOperationsAsQueued();
      return;
    }
    if (drainRunning) return;
    drainRunning = true;
    drainRequested = false;
    try {
      // Restore can invalidate the generation while the host initializes.
      // Finish that handshake before tagging a claim or starting its lease.
      await host.currentRevision();
      if (options.prepareMutationQueue) await prepareQueueRecovery();
      const now = Date.now();
      // A wakeup probes immediately, but must retain a future retry
      // deadline if the durable head is not eligible yet. Consume expired
      // hints so a head leased by another runner cannot cause a busy loop.
      if (deferredUntil !== undefined && deferredUntil <= now) {
        deferredUntil = undefined;
      }
      const epoch: StorageEpoch = { storageGeneration };
      const claimed = await host.claimNextMutation(
        owner,
        now,
        now + QUEUE_LEASE_MS
      );
      if (!claimed) {
        resolveLiveOperationsAsQueued();
        // Short retries keep their deadline; uncertain five-minute lease
        // backoffs must not prevent regular polling after a wakeup.
        scheduleDrain(
          deferredUntil === undefined
            ? EMPTY_QUEUE_POLL_MS
            : Math.min(
                EMPTY_QUEUE_POLL_MS,
                Math.max(0, deferredUntil - Date.now())
              )
        );
        return;
      }

      await routeClaimedMutation(claimed, epoch);
    } catch {
      // Enqueue already succeeded, so callers must observe these as
      // queued even if the runner cannot currently inspect the head.
      resolveLiveOperationsAsQueued();
      scheduleDrain(EMPTY_QUEUE_POLL_MS);
    } finally {
      drainRunning = false;
      if (drainRequested) scheduleDrain();
    }
  }

  async function prepareQueueRecovery(): Promise<void> {
    try {
      queuePreparation ??= boundedMutationLifecycle(() =>
        options.prepareMutationQueue!()
      );
      await queuePreparation;
    } catch (error) {
      queuePreparation = undefined;
      console.warn(
        '[graphql-cache] Unable to prepare mutation recovery',
        error
      );
    }
  }

  async function recordAttemptResult(
    attempt: QueueAttemptContext,
    result: OperationResult,
    retry: boolean
  ): Promise<void> {
    if (!attempt.mutation || !options.onMutationAttemptResult) return;
    try {
      await boundedMutationLifecycle(() =>
        options.onMutationAttemptResult!(attempt.mutation!, result, retry)
      );
    } catch (error) {
      try {
        options.onCacheError?.(error, result.operation);
      } catch {
        /* Diagnostics cannot retain a failed queue head. */
      }
    }
  }

  async function admit(
    op: Operation,
    enqueue: EnqueueOptimisticMutationResult,
    epoch: StorageEpoch
  ): Promise<OperationResult | undefined> {
    if (enqueue.upsertKind.kind === 'replaced-pending') {
      const superseded = liveQueuedOps.get(
        enqueue.upsertKind.removedTransactionId
      );
      if (superseded) {
        liveQueuedOps.delete(enqueue.upsertKind.removedTransactionId);
        superseded.resolveRoute(
          queuedMutationResult(
            superseded.operation,
            enqueue.upsertKind.removedTransactionId
          )
        );
      }
    }
    const routed = new Promise<OperationResult | undefined>((resolve) => {
      liveQueuedOps.set(enqueue.transactionId, {
        operation: op,
        resolveRoute: resolve,
      });
    });
    notifyOptimisticMutationEnqueued(op);
    try {
      await match(enqueue.initialClaim)
        .with({ kind: 'claimed' }, ({ mutation }) =>
          routeClaimedMutation(mutation, epoch)
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

  async function settle(
    networkResult: OperationResult,
    attempt: QueueAttemptContext
  ): Promise<OperationResult> {
    let result = networkResult;
    const op = result.operation;
    const detachedResult = () =>
      withOptimisticMutationDisposition(result, {
        kind:
          result.data != null && !result.error
            ? 'committed'
            : 'permanently-failed',
        transactionId: attempt.transactionId,
      });
    if (!transition(attempt, receiveResult)) return detachedResult();
    const claim = claimOf(attempt);
    let retryAt: number | undefined;
    let settled = false;
    let replacementTransactionId: string | undefined;
    let disposition:
      | 'committed'
      | 'queued'
      | 'superseded'
      | 'permanently-failed' = 'queued';
    try {
      const response = result.error?.response ?? attempt.response;
      const httpServerFailure = (response?.status ?? 0) >= 500;
      // A valid GraphQL payload can arrive over HTTP 5xx without an
      // urql error. Never commit it or bypass the retry policy.
      if (httpServerFailure && !result.error) {
        result = {
          ...result,
          data: undefined,
          error: new CombinedError({
            networkError: new Error(`HTTP ${response.status}`),
            response,
          }),
        };
      }
      if (result.error || result.data == null) {
        let retry = false;
        if (result.error && options.shouldRetryMutation) {
          try {
            retry = await options.shouldRetryMutation(result.error);
          } catch (error) {
            options.onCacheError?.(error, op);
          }
        }
        if (!isCurrent(attempt)) return detachedResult();
        // urql represents HTTP 5xx as networkError too. Count actual
        // server responses, never connection failures or timeouts.
        const serverFailure =
          httpServerFailure || (result.error?.graphQLErrors.length ?? 0) > 0;
        if (
          retry &&
          serverFailure &&
          attempt.serverFailureCount + 1 >= MAX_MUTATION_SERVER_FAILURES
        ) {
          retry = false;
          result = {
            ...result,
            error: new CombinedError({
              graphQLErrors: [
                {
                  message: `Mutation stopped after ${MAX_MUTATION_SERVER_FAILURES} server failures: ${result.error?.message}`,
                  extensions: { code: 'MUTATION_RETRY_EXHAUSTED' },
                },
              ],
              response: result.error?.response,
            }),
          };
        }
        await recordAttemptResult(attempt, result, retry);
        if (!isCurrent(attempt)) return detachedResult();
        if (retry) {
          retryAt = Date.now() + retryDelayMs(attempt.attemptCount);
          const deferred = await host.deferOptimisticWrite(
            attempt.transactionId,
            claim,
            retryAt,
            result.error?.message ?? 'mutation returned no data',
            serverFailure
          );
          if (!isCurrent(attempt)) return detachedResult();
          settled = true;
          if (deferred.kind === 'discarded-superseded') {
            retryAt = undefined;
            replacementTransactionId = deferred.replacementTransactionId;
            disposition = 'superseded';
          } else {
            disposition = 'queued';
          }
        } else {
          const rolledBack = await host.rollbackOptimisticWrite(
            attempt.transactionId,
            claim,
            result.error?.message ?? 'mutation returned no data',
            mutationErrorCode(result.error)
          );
          if (!isCurrent(attempt)) return detachedResult();
          settled = true;
          if (rolledBack.kind === 'discarded-superseded') {
            replacementTransactionId = rolledBack.replacementTransactionId;
            disposition = 'superseded';
          } else {
            disposition = 'permanently-failed';
            void deps.revalidate(rolledBack.revalidations ?? [], op);
          }
        }
      } else {
        const confirmed = { transactionId: attempt.transactionId, result };
        if (!transition(attempt, confirm(confirmed))) return detachedResult();
        await recordAttemptResult(attempt, result, false);
        if (!isCurrent(attempt)) return detachedResult();
        const committed = await host.commitOptimisticWrite(
          attempt.transactionId,
          claim,
          { ...deps.cacheDocument(op), data: result.data }
        );
        if (!transition(attempt, forgetConfirmed)) return detachedResult();
        settled = true;
        for (const error of committed.identityErrors ?? []) {
          try {
            options.onCacheError?.(new Error(error), op);
          } catch {
            // A diagnostic callback cannot undo confirmed settlement.
          }
        }
        if (committed.kind === 'failed') {
          const error = new Error(committed.error);
          try {
            options.onCacheError?.(error, op);
          } catch {
            // A diagnostic callback cannot undo confirmed settlement.
          }
          result = {
            ...result,
            data: undefined,
            error: new CombinedError({ networkError: error }),
          };
          replacementTransactionId = committed.replacementTransactionId;
          disposition = replacementTransactionId
            ? 'superseded'
            : 'permanently-failed';
          if (!replacementTransactionId) {
            void deps.revalidate(committed.revalidations ?? [], op);
          }
        } else if (committed.kind === 'committed-superseded') {
          replacementTransactionId = committed.replacementTransactionId;
          disposition = 'superseded';
          await deps.deleteReportedRecords(result);
        } else {
          disposition = 'committed';
          await deps.deleteReportedRecords(result);
          if (!isCurrent(attempt)) return detachedResult();
          const replay = deps.replayExplicitEffects(op, result.data, () =>
            isCurrent(attempt)
          );
          if (replay) await replay;
          if (isCurrent(attempt))
            await deps.revalidate(committed.revalidations ?? [], op);
        }
      }
    } catch (error) {
      try {
        options.onCacheError?.(error, op);
      } catch {
        // Reporting cannot discard the retained response or stop retries.
      }
      if (!settled && isCurrent(attempt)) {
        retryAt = Date.now() + QUEUE_LEASE_MS;
        // A lost acknowledgement may hide a completed transaction.
        // Preserve optimism and let a fresh durable claim decide.
        disposition = 'queued';
      }
    } finally {
      if (transition(attempt, release)) {
        liveQueuedOps.delete(attempt.transactionId);
        deferredUntil = retryAt;
        scheduleDrain(
          retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now())
        );
      }
    }
    return withOptimisticMutationDisposition(
      result,
      disposition === 'superseded'
        ? {
            kind: 'superseded',
            transactionId: attempt.transactionId,
            replacementTransactionId:
              replacementTransactionId ?? attempt.transactionId,
          }
        : {
            kind: disposition,
            transactionId: attempt.transactionId,
          }
    );
  }

  function resetStorage(): void {
    storageGeneration += 1;
    head = IDLE;
    deferredUntil = undefined;
    resolveLiveOperationsAsQueued();
  }

  return {
    epoch: () => ({ storageGeneration }),
    isCurrent,
    admit,
    settle,
    start: () => scheduleDrain(),
    wake: wakeDrain,
    resetStorage,
  };
}
