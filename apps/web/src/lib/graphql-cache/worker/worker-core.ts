/**
 * Dedicated engine-worker core: owns the elected browser WASM engine, serves
 * coordinator-routed RPCs, and fans out invalidations.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { match } from 'ts-pattern';
import {
  cacheRequestStamp,
  isReadOnlyCacheRequest,
} from '../host/read-availability';
import { executePeopleRequest } from '../people/worker';
import type {
  AffectedOperationsResult,
  CachePush,
  CacheRequest,
  CacheResponse,
  CacheRevisionResult,
  CalendarCommitCacheResult,
  CalendarRangeCacheResult,
  ChannelTimelineCacheResult,
  ChannelTimelineCommitCacheResult,
  ChannelTimelineEvictCacheResult,
  ChannelTimelineStatsCacheResult,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheResult,
  HydrationResult,
  ReadRecordsByKeysResult,
  ReadResult,
  SearchCachePage,
  WriteResult,
} from '../protocol';
import {
  isTypedSearch,
  isTypedSearchRowRead,
  LOCAL_COMMIT_FAILED,
  parseCacheRevision,
  parseStorageGeneration,
} from '../protocol';
import {
  type CacheTelemetryRecorderLike,
  classifyCacheError,
  describeCacheError,
  isolateCacheTelemetry,
  isStorageTransactionRequest,
  operationCategoryForRequest,
} from '../telemetry';
import { cacheDatabaseIdentity } from './coordinator-protocol';
import {
  type CacheEngine,
  type CacheEngineHydrationResult,
  type CacheOpenOutcome,
  type CacheOpenResult,
  type CacheWalCheckpoint,
  loadCacheWasm,
} from './wasm-module';

const isOwnerLockUnavailable = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'cacheOwnerLockUnavailable' in error &&
  error.cacheOwnerLockUnavailable === true;

/** WASM gave up on database files another context kept open. */
const isStorageBusy = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'cacheStorageBusy' in error &&
  error.cacheStorageBusy === true;

type PortLike = {
  postMessage(msg: unknown): void;
};

type RequestWaiter = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type QueuedEngineRequest = {
  request: CacheRequest;
  priority: number;
  readSignature?: string;
  waiters: RequestWaiter[];
  /** When the first of its waiters arrived, on the core's monotonic clock. */
  enqueuedAt: number;
};

// A page gives up on a request after 10 s; reporting from 1 s shows what held
// the engine on the way there.
const SLOW_REQUEST_MS = 1_000;

export interface CacheWorkerCoreOptions {
  /** Atomically recovery-wipes before any Turso open during initialization. */
  recoveryOpen?: boolean;
  /** Called once when WASM latches a reset-required storage failure. */
  onStorageResetRequired?: (error: Error) => void;
  /** Called when opening gave up on database files another context kept
   * open. The failed request's response carries only the message. */
  onStorageBusy?: () => void;
  /** Reports the bounded open outcome to the coordinator transport. */
  onInitializationOutcome?: (outcome: CacheOpenOutcome) => void;
  /**
   * Runs once WASM holds the database owner lock and before it touches OPFS;
   * opening proceeds when the returned promise resolves.
   */
  onOwnerLockAcquired?: () => Promise<void>;
  /**
   * With `onOwnerLockAcquired`, opening never queues for the owner lock. This
   * runs with the 1-based attempt that found it held elsewhere: resolve to
   * try again, or reject to give up without touching storage.
   */
  onOwnerLockBusy?: (attempt: number) => Promise<void>;
  telemetry?: CacheTelemetryRecorderLike;
  /** Injectable clocks and cadence for payload-free diagnostics tests. */
  monotonicNow?: () => number;
  wallClockNow?: () => number;
  queueDiagnosticsIntervalMs?: number;
  queueDiagnosticsTimeoutMs?: number;
  /** Calls `resume` once the messages already delivered have been handled. */
  afterArrivedMessages?: (resume: () => void) => void;
  /** Calls `run` once the engine has been quiet; returns a cancel. */
  afterQuiet?: (run: () => void) => () => void;
}

// A burst that keeps arriving must not hold back the requests already here.
const MAX_ARRIVAL_YIELDS = 256;

/** Runs `resume` in a later task, after a message that was already waiting. */
function afterArrivedMessages(resume: () => void): void {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    resume();
  };
  port2.postMessage(undefined);
}

/**
 * How long the engine stays quiet before it copies the WAL: long enough for
 * the requests a page sends on an answer (the boot reads after an open, the
 * re-reads after a write's change notice) to arrive and run first.
 */
const IDLE_CHECKPOINT_QUIET_MS = 100;

function afterQuiet(run: () => void): () => void {
  const timer = setTimeout(run, IDLE_CHECKPOINT_QUIET_MS);
  return () => clearTimeout(timer);
}

// Backfill hydration is cache warming, so foreground reads may overtake it.
// Hydration and authoritative writes still retain arrival order so stale
// hydration cannot overwrite a newer queued response.
const BACKGROUND_HYDRATION_PRIORITY = -1;
const NORMAL_READ_PRIORITY = 0;
const USER_VISIBLE_READ_PRIORITY = 1;
// Someone is typing and waiting on it, and unlike a list read it has no
// network fallback, so it runs before the rereads of lists already on screen.
const TYPED_SEARCH_PRIORITY = 2;
const CACHE_WRITE_PRIORITY = 3;

/** Reads may reorder while they overlap, but never across lifecycle barriers. */
function isOrderingBarrier(request: CacheRequest): boolean {
  return (
    request.kind === 'current-authority' ||
    request.kind === 'transition-authority' ||
    request.kind === 'init' ||
    request.kind === 'current-storage-generation' ||
    request.kind === 'teardown' ||
    request.kind === 'clear'
  );
}

/** A new engine or cleared storage: not even a typed search runs ahead. */
function stopsTypedSearch(request: CacheRequest): boolean {
  return (
    request.kind === 'init' ||
    request.kind === 'clear' ||
    request.kind === 'transition-authority'
  );
}

/** A change made on this device rather than a result from the network. */
function isLocalChange(request: CacheRequest): boolean {
  return (
    request.kind === 'enqueue-optimistic-mutation' ||
    request.kind === 'defer-optimistic-write' ||
    request.kind === 'commit-optimistic-write' ||
    request.kind === 'rollback-optimistic-write'
  );
}

function isAuthoritativeWrite(request: CacheRequest): boolean {
  // A calendar commit records coverage for data written just before it, so it
  // must never overtake that write or hydration.
  return (
    request.kind === 'write' ||
    request.kind === 'hydrate' ||
    request.kind === 'people-update' ||
    request.kind === 'commit-optimistic-write' ||
    request.kind === 'delete-records' ||
    request.kind === 'calendar-commit' ||
    request.kind === 'channel-timeline-commit' ||
    request.kind === 'channel-timeline-evict'
  );
}

function revisionAdvancementCategory(
  request: CacheRequest
):
  | 'authoritative-write'
  | 'optimistic-enqueue'
  | 'optimistic-commit'
  | 'optimistic-rollback'
  | 'external-invalidation'
  | 'deletion'
  | 'clear'
  | undefined {
  return match(request.kind)
    .with(
      'write',
      'hydrate',
      'people-update',
      'calendar-commit',
      'channel-timeline-commit',
      () => 'authoritative-write' as const
    )
    .with('enqueue-optimistic-mutation', () => 'optimistic-enqueue' as const)
    .with('commit-optimistic-write', () => 'optimistic-commit' as const)
    .with('rollback-optimistic-write', () => 'optimistic-rollback' as const)
    .with('invalidate', () => 'external-invalidation' as const)
    .with('delete-records', 'channel-timeline-evict', () => 'deletion' as const)
    .with('clear', () => 'clear' as const)
    .otherwise(() => undefined);
}

function requestPriority(request: CacheRequest): number {
  if (
    request.kind === 'hydrate' ||
    request.kind === 'people-update' ||
    request.kind === 'channel-timeline-evict'
  )
    return BACKGROUND_HYDRATION_PRIORITY;
  // A channel page is only read to paint an open channel or thread.
  if (request.kind === 'channel-timeline') return USER_VISIBLE_READ_PRIORITY;
  if (isTypedSearch(request)) return TYPED_SEARCH_PRIORITY;
  if (request.kind === 'read') {
    return request.priority === 'user-visible'
      ? USER_VISIBLE_READ_PRIORITY
      : NORMAL_READ_PRIORITY;
  }
  if (
    request.kind === 'write' ||
    request.kind === 'calendar-commit' ||
    request.kind === 'channel-timeline-commit' ||
    request.kind === 'enqueue-optimistic-mutation' ||
    request.kind === 'claim-next-mutation' ||
    request.kind === 'commit-optimistic-write' ||
    request.kind === 'rollback-optimistic-write' ||
    request.kind === 'invalidate' ||
    request.kind === 'delete-records'
  ) {
    return CACHE_WRITE_PRIORITY;
  }
  return NORMAL_READ_PRIORITY;
}

/** Exact active-operation reads can share one denormalization/storage pass. */
function readSignature(request: CacheRequest): string | undefined {
  if (request.kind !== 'read' || request.opId === undefined) return;
  return JSON.stringify([
    request.generation ?? null,
    request.opId,
    request.query,
    request.operationName ?? null,
    request.variables ?? null,
    request.entityResolvers ?? null,
    request.watch ?? null,
  ]);
}

export class CacheWorkerCore {
  private engine: CacheEngine | undefined;
  private initPromise: Promise<void> | undefined;
  private scope: string | undefined;
  /** Serializes engine calls while allowing safe read prioritization. */
  private readonly queue: QueuedEngineRequest[] = [];
  private running = false;
  /** Between two requests, while arrivals join the queue. */
  private yielding = false;
  /** A request that can write ran since the last WAL checkpoint. */
  private checkpointPending = false;
  private cancelIdleCheckpoint: (() => void) | undefined;
  private readonly afterArrivedMessages: (resume: () => void) => void;
  private readonly afterQuiet: (run: () => void) => () => void;
  private acceptingRequests = true;
  private activeRequestHandlers = 0;
  private readonly drainWaiters = new Set<() => void>();
  private resetRequiredReported = false;
  private executingAuthority: string | undefined;
  private hotCapacity: number | undefined;
  private readonly ports = new Set<PortLike>();
  private readonly telemetry: CacheTelemetryRecorderLike;
  private readonly now: () => number;
  private readonly wallClockNow: () => number;
  private readonly queueDiagnosticsIntervalMs: number;
  private readonly queueDiagnosticsTimeoutMs: number;
  private lastQueueDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private latestQueueDiagnostics:
    | { depth: number; oldestCreatedAtMs?: number }
    | undefined;
  private cancelQueueDiagnostics: (() => void) | undefined;

  constructor(private readonly options: CacheWorkerCoreOptions = {}) {
    this.telemetry = isolateCacheTelemetry(options.telemetry);
    this.now =
      options.monotonicNow ??
      (() => globalThis.performance?.now() ?? Date.now());
    this.wallClockNow = options.wallClockNow ?? (() => Date.now());
    this.queueDiagnosticsIntervalMs =
      options.queueDiagnosticsIntervalMs ?? 60_000;
    this.queueDiagnosticsTimeoutMs = options.queueDiagnosticsTimeoutMs ?? 250;
    this.afterArrivedMessages =
      options.afterArrivedMessages ?? afterArrivedMessages;
    this.afterQuiet = options.afterQuiet ?? afterQuiet;
  }

  addPort(port: PortLike): void {
    this.ports.add(port);
  }

  removePort(port: PortLike): void {
    this.ports.delete(port);
  }

  async handleRequest(port: PortLike, request: CacheRequest): Promise<void> {
    const respond = (response: CacheResponse) => port.postMessage(response);
    const startedAt = this.now();
    const category = operationCategoryForRequest(request);
    if (!this.acceptingRequests) {
      this.telemetry.record({
        name: 'graphql_cache.engine_request',
        operationCategory: category,
        outcome: 'error',
        errorCode: 'owner-lost',
        durationMs: this.now() - startedAt,
      });
      respond({
        id: request.id,
        ok: false,
        error: 'cache engine is draining',
      });
      return;
    }

    this.activeRequestHandlers += 1;
    try {
      const envelope = (await this.enqueue(request)) as {
        result: unknown;
        authorityGeneration?: string;
      };
      const result = envelope.result;
      const durationMs = this.now() - startedAt;
      const revisionCategory = revisionAdvancementCategory(request);
      const revisionAdvanced =
        typeof result !== 'object' ||
        result === null ||
        !('revisionAdvanced' in result) ||
        result.revisionAdvanced !== false;
      if (revisionCategory !== undefined && revisionAdvanced) {
        this.telemetry.record({
          name: 'graphql_cache.revision_advance',
          operationCategory: category,
          outcome: 'success',
          errorCode: 'none',
          revisionCategory,
        });
      }
      this.telemetry.record({
        name: 'graphql_cache.engine_request',
        operationCategory: category,
        outcome: 'success',
        errorCode: 'none',
        durationMs,
      });
      if (isStorageTransactionRequest(request)) {
        this.telemetry.record({
          name: 'graphql_cache.transaction',
          operationCategory: category,
          outcome: 'success',
          errorCode: 'none',
          durationMs,
        });
      }
      if (
        (request.kind === 'write' || request.kind === 'hydrate') &&
        typeof result === 'object' &&
        result !== null &&
        'reset' in result &&
        result.reset === true
      ) {
        this.telemetry.record({
          name: 'graphql_cache.logical_reset',
          operationCategory: 'storage',
          outcome: 'success',
          errorCode: 'none',
          resetReason: 'identity-change',
        });
      }
      if (request.kind === 'read') {
        this.telemetry.record({
          name: 'graphql_cache.read',
          operationCategory: 'read',
          outcome:
            typeof result === 'object' &&
            result !== null &&
            'kind' in result &&
            result.kind === 'hit'
              ? 'hit'
              : 'miss',
          durationMs,
        });
      }
      respond({ id: request.id, ok: true, ...envelope });
    } catch (error) {
      const durationMs = this.now() - startedAt;
      const errorCode = classifyCacheError(error);
      this.telemetry.record({
        name: 'graphql_cache.engine_request',
        operationCategory: category,
        outcome: 'error',
        errorCode,
        durationMs,
      });
      if (isStorageTransactionRequest(request)) {
        this.telemetry.record({
          name: 'graphql_cache.transaction',
          operationCategory: category,
          outcome: 'error',
          errorCode,
          durationMs,
        });
      }
      this.reportResetRequired(error);
      if (isStorageBusy(error)) this.options.onStorageBusy?.();
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeRequestHandlers -= 1;
      this.resolveDrainWaitersIfIdle();
    }
  }

  /** Stops admission, drains every earlier request/response, then closes OPFS. */
  async drain(): Promise<void> {
    this.acceptingRequests = false;
    // A best-effort observation may never delay correctness teardown.
    this.cancelQueueDiagnostics?.();
    this.cancelIdleCheckpoint?.();
    this.cancelIdleCheckpoint = undefined;
    if (
      this.activeRequestHandlers > 0 ||
      this.running ||
      this.queue.length > 0
    ) {
      await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
    }
    if (this.initPromise) await this.initPromise.catch(() => undefined);
    const engine = this.engine;
    if (!engine) return;
    this.recordCachedQueueDiagnostics();
    this.engine = undefined;
    try {
      await engine.close();
    } catch (error) {
      this.reportResetRequired(error);
      throw error;
    }
  }

  /**
   * The rows a typed search named rank with it, as the search is not answered
   * for the person waiting until they list. They may run before a network
   * result queued ahead of them: that is the result arriving a moment later,
   * and its cache change refreshes the list. A change this page made itself
   * must show in rows read after it, so behind one of those a row read orders
   * like any other record read.
   */
  private arrivalPriority(request: CacheRequest): number {
    if (!isTypedSearchRowRead(request)) return requestPriority(request);

    return this.queue.some((queued) => isLocalChange(queued.request))
      ? NORMAL_READ_PRIORITY
      : TYPED_SEARCH_PRIORITY;
  }

  private enqueue(request: CacheRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const priority = this.arrivalPriority(request);
      const signature = readSignature(request);

      // Coalesce only within the current lifecycle segment. In particular, a
      // remount after teardown must perform a fresh read to re-register deps.
      if (signature !== undefined) {
        let segmentStart = 0;
        for (let i = this.queue.length - 1; i >= 0; i -= 1) {
          const queued = this.queue[i];
          if (queued && isOrderingBarrier(queued.request)) {
            segmentStart = i + 1;
            break;
          }
        }
        const duplicate = this.queue
          .slice(segmentStart)
          .find((queued) => queued.readSignature === signature);
        if (duplicate) {
          duplicate.priority = Math.max(duplicate.priority, priority);
          duplicate.waiters.push({ resolve, reject });
          this.collectArrivalsThenDrain();
          return;
        }
      }

      this.queue.push({
        request,
        priority,
        readSignature: signature,
        waiters: [{ resolve, reject }],
        enqueuedAt: this.now(),
      });
      this.collectArrivalsThenDrain();
    });
  }

  /**
   * Runs the highest-priority request before the next lifecycle barrier.
   * Authoritative writes retain FIFO order with each other; overlapping reads
   * may observe the newer state, which is linearizable and avoids stale work.
   */
  private drainQueue(): void {
    if (this.running || this.yielding || this.queue.length === 0) return;

    let segmentEnd = this.queue.findIndex((queued) =>
      isOrderingBarrier(queued.request)
    );
    if (segmentEnd === -1) segmentEnd = this.queue.length;

    const firstAuthoritativeWrite = this.queue
      .slice(0, segmentEnd)
      .findIndex((queued) => isAuthoritativeWrite(queued.request));
    let index = 0;
    if (segmentEnd > 0) {
      for (let i = 1; i < segmentEnd; i += 1) {
        const candidate = this.queue[i];
        const selected = this.queue[index];
        const preservesWriteOrder =
          !candidate ||
          !isAuthoritativeWrite(candidate.request) ||
          i === firstAuthoritativeWrite;
        if (
          candidate &&
          selected &&
          preservesWriteOrder &&
          candidate.priority > selected.priority
        ) {
          index = i;
        }
      }
    }

    index = this.pickPastFences(
      index,
      this.queue[index]?.priority ?? Number.NEGATIVE_INFINITY,
      segmentEnd
    );

    const [queued] = this.queue.splice(index, 1);
    if (!queued) return;
    this.running = true;
    const startedAt = this.now();
    const queueDepth = this.queue.length;
    void this.dispatch(queued.request)
      .then(
        async (result) => {
          this.recordSlowRequest(queued, startedAt, queueDepth);
          // Resolve the cache result before the bounded observation checkpoint.
          for (const waiter of queued.waiters) waiter.resolve(result);
          if (isStorageTransactionRequest(queued.request)) {
            await this.refreshQueueDiagnostics(false);
          }
        },
        (error) => {
          this.recordSlowRequest(queued, startedAt, queueDepth, { error });
          for (const waiter of queued.waiters) waiter.reject(error);
        }
      )
      .finally(() => {
        this.running = false;
        if (!isReadOnlyCacheRequest(queued.request.kind)) {
          this.checkpointPending = true;
        }
        this.collectArrivalsThenDrain();
        this.scheduleIdleCheckpoint();
        this.resolveDrainWaitersIfIdle();
      });
  }

  /**
   * Turso copies the WAL into the database file inside the COMMIT that takes
   * it to 1,000 frames, so one write pays for the others. After a request
   * that can write, once the engine has been quiet for a moment, it copies
   * the WAL here from 500 frames instead. Each request that runs re-arms the
   * wait, so the requests a page sends on an answer run before the copy. One
   * that arrives during the copy waits for it, as it waited for the write
   * that used to carry it.
   */
  private scheduleIdleCheckpoint(): void {
    this.cancelIdleCheckpoint?.();
    this.cancelIdleCheckpoint = undefined;
    if (!this.checkpointPending || !this.acceptingRequests) return;
    const engine = this.engine;
    const checkpointIfDue = engine?.checkpointIfDue?.bind(engine);
    if (!checkpointIfDue) {
      // An engine without it keeps Turso's own checkpoint.
      this.checkpointPending = false;
      return;
    }
    this.cancelIdleCheckpoint = this.afterQuiet(() => {
      this.cancelIdleCheckpoint = undefined;
      if (
        this.running ||
        this.yielding ||
        this.queue.length > 0 ||
        !this.acceptingRequests ||
        this.engine !== engine
      ) {
        // A request is under way and re-arms the wait when it finishes.
        return;
      }
      this.checkpointPending = false;
      this.running = true;
      fireAndForget(
        this.runIdleCheckpoint(checkpointIfDue),
        'graphql_cache.wal_checkpoint'
      );
    });
  }

  /** Runs one idle copy, records it, and drains what arrived meanwhile. */
  private async runIdleCheckpoint(
    checkpointIfDue: () => Promise<CacheWalCheckpoint>
  ): Promise<void> {
    const startedAt = this.now();
    try {
      const checkpoint = await checkpointIfDue();
      if (checkpoint.ran) {
        this.telemetry.record({
          name: 'graphql_cache.wal_checkpoint',
          operationCategory: 'storage',
          outcome: 'success',
          errorCode: 'none',
          durationMs: this.now() - startedAt,
          count: checkpoint.backfilledFrames,
          walFrames: checkpoint.walFrames,
        });
      }
    } catch (error) {
      // A failed copy leaves the WAL whole; the next idle retries it.
      this.checkpointPending = true;
      this.telemetry.record({
        name: 'graphql_cache.wal_checkpoint',
        operationCategory: 'storage',
        outcome: 'error',
        ...describeCacheError(error),
        durationMs: this.now() - startedAt,
      });
      this.reportResetRequired(error);
      if (isStorageBusy(error)) this.options.onStorageBusy?.();
    } finally {
      this.running = false;
      this.collectArrivalsThenDrain();
      this.resolveDrainWaitersIfIdle();
    }
  }

  /**
   * Reports a request answered a second or more after it arrived, split into
   * the time it waited behind others and the time it ran, so a page timeout
   * can be traced to the request that held the engine.
   */
  private recordSlowRequest(
    queued: QueuedEngineRequest,
    startedAt: number,
    queueDepth: number,
    failure?: { error: unknown }
  ): void {
    const finishedAt = this.now();
    if (finishedAt - queued.enqueuedAt < SLOW_REQUEST_MS) return;
    this.telemetry.record({
      name: 'graphql_cache.slow_request',
      operationCategory: operationCategoryForRequest(queued.request),
      requestKind: queued.request.kind,
      outcome: failure ? 'error' : 'success',
      errorCode: failure ? classifyCacheError(failure.error) : 'none',
      queueWaitMs: startedAt - queued.enqueuedAt,
      durationMs: finishedAt - startedAt,
      queueDepth,
    });
  }

  /**
   * A typed search registers nothing and writes nothing, so the generation
   * checks and operation teardowns that fence other reads do not order it.
   * After an engine restart those fences sit between it and the head of the
   * replayed backlog. It can then run before a write queued ahead of it:
   * its rows are only older, and that write's cache change refreshes them.
   * A row read that ranks with the search crosses the same fences; it carries
   * no operation, and no local change was queued ahead of it when it arrived.
   */
  private pickPastFences(
    selectedIndex: number,
    selectedPriority: number,
    segmentEnd: number
  ): number {
    let index = selectedIndex;
    let priority = selectedPriority;
    let searchEnd = this.queue.findIndex((queued) =>
      stopsTypedSearch(queued.request)
    );
    if (searchEnd === -1) searchEnd = this.queue.length;
    for (let i = segmentEnd; i < searchEnd; i += 1) {
      const candidate = this.queue[i];
      if (
        candidate &&
        candidate.priority === TYPED_SEARCH_PRIORITY &&
        candidate.priority > priority
      ) {
        index = i;
        priority = candidate.priority;
      }
    }
    return index;
  }

  /**
   * The queued request to run while a hydrate's write waits, when it only
   * reads: the one `drainQueue` would pick were that write still queued
   * first. Every authoritative write queued keeps its place behind it, and
   * anything that is not a read waits for it.
   */
  private pickReadBeforeHydrateCommit(): number | undefined {
    let segmentEnd = this.queue.findIndex((queued) =>
      isOrderingBarrier(queued.request)
    );
    if (segmentEnd === -1) segmentEnd = this.queue.length;
    let index = -1;
    let priority = BACKGROUND_HYDRATION_PRIORITY;
    for (let i = 0; i < segmentEnd; i += 1) {
      const candidate = this.queue[i];
      if (
        candidate &&
        !isAuthoritativeWrite(candidate.request) &&
        candidate.priority > priority
      ) {
        index = i;
        priority = candidate.priority;
      }
    }
    index = this.pickPastFences(index, priority, segmentEnd);
    const picked = this.queue[index];
    return picked && isReadOnlyCacheRequest(picked.request.kind)
      ? index
      : undefined;
  }

  /**
   * Runs the reads that arrived while a step of a hydrate ran, before its
   * next step. A hydrate runs in wasm without yielding, so a read sent
   * meanwhile used to wait for all of it; now it waits for one step.
   */
  private async runReadsBeforeHydrateCommit(): Promise<void> {
    // A failed request forgets the authority so the next one checks it
    // again, in case it committed a transition. A read commits nothing, so
    // the hydrate's notifications keep the authority it ran under.
    const authority = this.executingAuthority;
    for (let yields = 0; yields < MAX_ARRIVAL_YIELDS; yields += 1) {
      try {
        await new Promise<void>((resume) => this.afterArrivedMessages(resume));
      } catch {
        // Without a way to yield, the reads wait for the write.
        return;
      }
      let ran = false;
      for (
        let index = this.pickReadBeforeHydrateCommit();
        index !== undefined;
        index = this.pickReadBeforeHydrateCommit()
      ) {
        const [queued] = this.queue.splice(index, 1);
        if (!queued) break;
        ran = true;
        const startedAt = this.now();
        const queueDepth = this.queue.length;
        try {
          const result = await this.dispatch(queued.request);
          this.recordSlowRequest(queued, startedAt, queueDepth);
          for (const waiter of queued.waiters) waiter.resolve(result);
        } catch (error) {
          this.executingAuthority = authority;
          this.recordSlowRequest(queued, startedAt, queueDepth, { error });
          for (const waiter of queued.waiters) waiter.reject(error);
        }
      }
      // More may have arrived while these ran.
      if (!ran) return;
    }
  }

  /** A hydrate, its write held back for the reads that arrive meanwhile. */
  private async hydrate(
    request: Extract<CacheRequest, { kind: 'hydrate' }>
  ): Promise<CacheEngineHydrationResult> {
    const engine = this.requireEngine();
    const prepare = engine.prepareHydrate?.bind(engine);
    const commit = engine.commitHydrate?.bind(engine);
    if (!prepare || !commit) {
      return await engine.hydrateQuery(
        request.query,
        request.operationName,
        request.variables,
        request.data,
        request.identity,
        request.hydrationScope
      );
    }
    await prepare(
      request.query,
      request.operationName,
      request.variables,
      request.data,
      request.identity,
      request.hydrationScope
    );
    await this.runReadsBeforeHydrateCommit();
    const step = engine.stepHydrate?.bind(engine);
    if (step) {
      // One projection pass at a time, so a read waits for one, not all.
      while (await step()) await this.runReadsBeforeHydrateCommit();
    }
    const stage = engine.stageHydrate?.bind(engine);
    if (stage) {
      // Most of the write is reading what it merges into: done here, it
      // leaves the commit short for the reads that wait on it. A failed stage
      // fails the hydrate before any read runs.
      await stage();
      await this.runReadsBeforeHydrateCommit();
    }
    return await commit();
  }

  /**
   * Starts the next request only once the requests already sent have joined
   * the queue. The browser delivers one message per task and engine calls
   * run to completion, so a request started the moment it arrives always
   * finishes before the next is even seen: the queue never holds two, and
   * its priorities never apply. Each yield lets waiting messages in; it
   * repeats while they keep coming, up to a bound.
   */
  private collectArrivalsThenDrain(yieldsLeft = MAX_ARRIVAL_YIELDS): void {
    if (this.running || this.yielding || this.queue.length === 0) return;

    // Nothing still on its way would be picked ahead of a typed search, and
    // it is the one request someone is waiting on.
    if (this.queue.every((queued) => isTypedSearch(queued.request))) {
      this.drainQueue();
      return;
    }

    const seen = this.queue.length;
    const resume = () => {
      this.yielding = false;
      if (this.queue.length > seen && yieldsLeft > 1) {
        this.collectArrivalsThenDrain(yieldsLeft - 1);
        return;
      }

      this.drainQueue();
      this.resolveDrainWaitersIfIdle();
    };
    this.yielding = true;
    try {
      this.afterArrivedMessages(resume);
    } catch {
      // Without a way to yield, keep the queue moving in arrival order.
      this.yielding = false;
      this.drainQueue();
    }
  }

  private async dispatch(request: CacheRequest): Promise<unknown> {
    let before = this.executingAuthority;
    if (request.kind !== 'init') {
      if (
        before === undefined ||
        (!isReadOnlyCacheRequest(request.kind) &&
          request.kind !== 'current-authority')
      ) {
        const authority = await this.requireEngine().currentAuthority(
          this.scope!
        );
        before = authority.generation;
        if (this.executingAuthority !== before)
          this.push({ kind: 'authority-changed', authority });
        this.executingAuthority = before;
      }
      const storesContent = cacheRequestStamp(request.kind) === 'captured';
      const removes =
        request.kind === 'invalidate' || request.kind === 'delete-records';
      // A queued command settles under its own stamp even once that is stale.
      const settlesCommand =
        request.kind === 'enqueue-optimistic-mutation' ||
        request.kind === 'commit-optimistic-write';
      const mustBeCurrent = (storesContent && !settlesCommand) || removes;
      if (
        (mustBeCurrent && request.generation !== before) ||
        (storesContent && request.generation === undefined)
      )
        throw new Error(
          'cache response belongs to an older session generation'
        );
    }
    let result: unknown;
    try {
      result = await this.execute(request);
    } catch (error) {
      // A failed transition may have committed its closed marker. The next
      // request must resume it before any read, even on the warm read path.
      this.executingAuthority = undefined;
      throw error;
    }
    if (
      request.kind === 'write' ||
      request.kind === 'hydrate' ||
      request.kind === 'people-update'
    ) {
      const authority = await this.requireEngine().currentAuthority(
        this.scope!
      );
      this.executingAuthority = authority.generation;
      if (authority.generation !== before)
        this.push({ kind: 'authority-changed', authority });
    }
    return { result, authorityGeneration: this.executingAuthority };
  }

  private async execute(request: CacheRequest): Promise<unknown> {
    if ('variables' in request && request.variables !== undefined) {
      // Structured clone retains undefined object fields; serde-wasm-bindgen
      // reads them as null. Match the JSON sent to GraphQL and stored in durable
      // link recipes, or a query and its optimistic updates address different
      // cache fields. Explicit nulls (including array slots) remain distinct.
      request = {
        ...request,
        variables: JSON.parse(JSON.stringify(request.variables)),
      };
    }
    return await match(request)
      .with({ kind: 'init' }, async (request) => {
        await this.init(request.scope, request.hotCapacity);
        this.executingAuthority = (
          await this.requireEngine().currentAuthority(request.scope)
        ).generation;
        return null;
      })
      .with({ kind: 'current-authority' }, async (request) => {
        const authority = await this.requireEngine().currentAuthority(
          request.identity
        );
        if (this.executingAuthority !== authority.generation)
          this.push({ kind: 'authority-changed', authority });
        this.executingAuthority = authority.generation;
        return authority;
      })
      .with({ kind: 'transition-authority' }, async (request) => {
        const context = request.traceparent
          ? Telemetry.remoteContext(request.traceparent)
          : Telemetry.captureContext();
        const result = await context.run(() =>
          Telemetry.span('crm.access.owner.execute', async (span) => {
            const result = await this.requireEngine().transitionAuthority(
              request.identity,
              request.expected,
              request.policy
            );
            span.setAttr('crm.access.changed', result.changed);
            return result;
          })
        );
        this.executingAuthority = result.authority.generation;
        if (result.changed) {
          this.push({ kind: 'authority-changed', authority: result.authority });
          this.push({
            kind: 'ops-affected',
            opIds: result.affectedOps,
            keys: [],
          });
          this.push({
            kind: 'cache-changed',
            revision: parseCacheRevision(result.revision),
          });
        }
        return result;
      })
      .with({ kind: 'current-revision' }, async () => {
        return parseCacheRevision(await this.requireEngine().currentRevision());
      })
      .with({ kind: 'current-storage-generation' }, async () => {
        return parseStorageGeneration(
          await this.requireEngine().currentStorageGeneration()
        );
      })
      .with({ kind: 'read' }, async (request) => {
        const engine = this.requireEngine();
        if (request.watch) {
          if (!engine.watchQuery || !request.opId)
            return { kind: 'unsupported' };
          return await engine.watchQuery(
            request.opId,
            request.query,
            request.operationName,
            request.variables,
            request.entityResolvers,
            request.watch.since
          );
        }
        const result: ReadResult = await engine.readQuery(
          request.opId,
          request.query,
          request.operationName,
          request.variables,
          request.entityResolvers
        );
        return result;
      })
      .with({ kind: 'read-records-by-keys' }, async (request) => {
        const result: ReadRecordsByKeysResult =
          await this.requireEngine().readRecordsByKeys(
            request.document,
            request.fragmentName,
            request.keys
          );
        return {
          ...result,
          revision: parseCacheRevision(result.revision),
        };
      })
      .with(
        { kind: 'people-context' },
        { kind: 'people-update' },
        { kind: 'people-search' },
        { kind: 'people-references' },
        { kind: 'people-sql' },
        { kind: 'contact-snapshot' },
        { kind: 'contact-reconcile' },
        (request) =>
          executePeopleRequest(
            this.requireEngine(),
            request,
            (message) => this.push(message),
            (result) => this.fanOut(result, true)
          )
      )
      .with({ kind: 'search' }, async (request) => {
        const result: SearchCachePage = await this.requireEngine().search(
          request.request
        );
        return result;
      })
      .with({ kind: 'entity-filter' }, async (request) => {
        const result: EntityFilterCacheResult =
          await this.requireEngine().entityFilter(request.request);
        return result.kind === 'unsupported'
          ? result
          : { ...result, revision: parseCacheRevision(result.revision) };
      })
      .with({ kind: 'calendar-range' }, async (request) => {
        const result: CalendarRangeCacheResult =
          await this.requireEngine().calendarRange(request.request);
        return result.kind === 'unsupported'
          ? result
          : { ...result, revision: parseCacheRevision(result.revision) };
      })
      .with({ kind: 'calendar-commit' }, async (request) => {
        const result = await this.requireEngine().calendarCommit(
          request.commit
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        const committed: CalendarCommitCacheResult = {
          kind: 'committed',
          revision: result.revision,
          changed: result.changed,
        };
        return committed;
      })
      .with({ kind: 'channel-timeline' }, async (request) => {
        const result: ChannelTimelineCacheResult =
          await this.requireEngine().channelTimeline(request.request);
        return result.kind === 'unsupported'
          ? result
          : { ...result, revision: parseCacheRevision(result.revision) };
      })
      .with({ kind: 'channel-timeline-commit' }, async (request) => {
        const { channelSeq, ...result } =
          await this.requireEngine().channelTimelineCommit(request.commit);
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        const committed: ChannelTimelineCommitCacheResult = {
          kind: 'committed',
          revision: result.revision,
          changed: result.changed,
          channelSeq,
        };
        return committed;
      })
      .with({ kind: 'channel-timeline-evict' }, async (request) => {
        const { channelIds, hasMore, ...result } =
          await this.requireEngine().channelTimelineEvict(request.eviction);
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        const evicted: ChannelTimelineEvictCacheResult = {
          kind: 'evicted',
          revision: result.revision,
          changed: result.changed,
          channelIds,
          hasMore,
        };
        return evicted;
      })
      .with({ kind: 'channel-timeline-stats' }, async () => {
        const stats: ChannelTimelineStatsCacheResult = {
          kind: 'stats',
          ...(await this.requireEngine().channelTimelineStats()),
        };
        return stats;
      })
      .with({ kind: 'write' }, async (request) => {
        const engine = this.requireEngine();
        const result = await engine.writeQuery(
          {
            originOpId: request.originOpId,
            registration: request.registration,
          },
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.identity
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        return result;
      })
      .with({ kind: 'hydrate' }, async (request) => {
        const result = await this.hydrate(request);
        result.revision = parseCacheRevision(result.revision);
        // Only cache-only consumers opt into hydration. Do not invalidate
        // foreground Soup queries or switch their authority mid-backfill.
        // Identity changes remain ordinary cache resets for every subscriber.
        if (result.reset) this.fanOut(result, true);
        else if (result.revisionAdvanced) {
          this.push({
            kind: 'cache-hydrated',
            revision: result.revision,
            ...(result.searchChangedBuckets !== undefined
              ? { searchChangedBuckets: result.searchChangedBuckets }
              : {}),
          });
        }
        const hydration: HydrationResult & Pick<WriteResult, 'reset'> =
          result.data === null
            ? { kind: 'void', revision: result.revision, reset: result.reset }
            : {
                kind: 'data',
                data: result.data,
                revision: result.revision,
                reset: result.reset,
              };
        return hydration;
      })
      .with({ kind: 'enqueue-optimistic-mutation' }, async (request) => {
        const engine = this.requireEngine();
        const result: EnqueueOptimisticMutationResult =
          await engine.enqueueOptimisticMutation(
            request.originOpId,
            request.uuid,
            request.query,
            request.operationName,
            request.variables,
            request.data,
            request.linkPatches,
            request.revalidations,
            request.identityBindings,
            request.createdAtMs,
            request.owner,
            request.nowMs,
            request.leaseExpiresAtMs,
            request.clientMetadata,
            request.uncertainCalendarEventKeys,
            request.generation
          );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        if (result.upsertKind.kind === 'replaced-pending') {
          this.push({
            kind: 'mutation-settled',
            settlement: {
              transactionId: result.upsertKind.removedTransactionId,
              mutationUuid: request.uuid,
              status: 'superseded',
              replacementTransactionId: result.transactionId,
            },
          });
        }
        return result;
      })
      .with({ kind: 'inspect-query-variants' }, async (request) => {
        return await this.requireEngine().inspectQueryVariants(
          request.query,
          request.operationName,
          request.path
        );
      })
      .with({ kind: 'inspect-query' }, async (request) => {
        return await this.requireEngine().inspectQuery(
          request.query,
          request.operationName,
          request.path,
          JSON.parse(JSON.stringify(request.variableFilters ?? []))
        );
      })
      .with(
        { kind: 'inspect-mutations' },
        async () => await this.requireEngine().inspectMutations()
      )
      .with({ kind: 'claim-next-mutation' }, async (request) => {
        const engine = this.requireEngine();
        return await engine.claimNextMutation(
          request.owner,
          request.nowMs,
          request.leaseExpiresAtMs
        );
      })
      .with({ kind: 'defer-optimistic-write' }, async (request) => {
        const engine = this.requireEngine();
        const result = await engine.deferOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration,
          request.nextAttemptAtMs,
          request.error,
          request.serverFailure ?? false
        );
        if (result.kind === 'discarded-superseded') {
          result.revision = parseCacheRevision(result.revision);
          this.fanOut(result, true);
          this.push({
            kind: 'mutation-settled',
            settlement: {
              transactionId: request.transactionId,
              mutationUuid: result.mutationUuid,
              status: 'superseded',
              replacementTransactionId: result.replacementTransactionId,
            },
          });
        }
        return result;
      })
      .with({ kind: 'commit-optimistic-write' }, async (request) => {
        const engine = this.requireEngine();
        // Committing can flush settled layers into durable storage.
        const result = await engine.commitOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration,
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.generation
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        const replacementTransactionId =
          result.kind === 'committed'
            ? undefined
            : result.replacementTransactionId;
        this.push({
          kind: 'mutation-settled',
          settlement:
            replacementTransactionId !== undefined
              ? {
                  transactionId: request.transactionId,
                  mutationUuid: result.mutationUuid,
                  status: 'superseded',
                  replacementTransactionId,
                }
              : result.kind === 'failed'
                ? {
                    transactionId: request.transactionId,
                    mutationUuid: result.mutationUuid,
                    status: 'permanently-failed',
                    error: result.error,
                    // The server took the mutation: only this device could
                    // not store its answer.
                    errorCode: LOCAL_COMMIT_FAILED,
                  }
                : {
                    transactionId: request.transactionId,
                    mutationUuid: result.mutationUuid,
                    status: 'committed',
                  },
        });
        return result;
      })
      .with({ kind: 'rollback-optimistic-write' }, async (request) => {
        const engine = this.requireEngine();
        const result = await engine.rollbackOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(result, true);
        this.push({
          kind: 'mutation-settled',
          settlement:
            result.kind === 'discarded-superseded'
              ? {
                  transactionId: request.transactionId,
                  mutationUuid: result.mutationUuid,
                  status: 'superseded',
                  replacementTransactionId: result.replacementTransactionId,
                }
              : {
                  transactionId: request.transactionId,
                  mutationUuid: result.mutationUuid,
                  status: 'permanently-failed',
                  error: request.error,
                  ...(request.errorCode === undefined
                    ? {}
                    : { errorCode: request.errorCode }),
                },
        });
        return result;
      })
      .with({ kind: 'invalidate' }, async (request) => {
        const engine = this.requireEngine();
        const result: AffectedOperationsResult = await engine.invalidateKeys(
          request.keys
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(
          {
            revision: result.revision,
            revisionAdvanced: true,
            changed: request.keys,
            affectedOps: result.affectedOps,
            reset: false,
            revalidations: [],
          },
          true
        );
        return result;
      })
      .with({ kind: 'delete-records' }, async (request) => {
        const engine = this.requireEngine();
        const result: AffectedOperationsResult = await engine.deleteKeys(
          request.keys
        );
        result.revision = parseCacheRevision(result.revision);
        this.fanOut(
          {
            revision: result.revision,
            revisionAdvanced: true,
            changed: request.keys,
            affectedOps: result.affectedOps,
            reset: false,
            revalidations: [],
          },
          true
        );
        return result;
      })
      .with({ kind: 'teardown' }, async (request) => {
        await this.requireEngine().teardownOperation(request.opId);
        return null;
      })
      .with({ kind: 'clear' }, async () => {
        const result: CacheRevisionResult = await this.requireEngine().clear();
        this.executingAuthority = undefined;
        const revision = parseCacheRevision(result.revision);
        this.push({ kind: 'cache-changed', revision, reset: true });
        return revision;
      })
      .exhaustive(() =>
        Promise.reject(new Error('Unknown cache worker request'))
      );
  }

  /** Emits the latest successful snapshot without touching storage. */
  recordCachedQueueDiagnostics(): void {
    const snapshot = this.latestQueueDiagnostics;
    this.telemetry.record({
      name: 'graphql_cache.queue_diagnostics',
      operationCategory: 'queue',
      outcome: 'success',
      errorCode: 'none',
      queueDiagnosticsAvailability: snapshot ? 'available' : 'unavailable',
      ...(snapshot
        ? {
            queueDepth: snapshot.depth,
            oldestAgeMs:
              snapshot.oldestCreatedAtMs === undefined
                ? 0
                : Math.max(0, this.wallClockNow() - snapshot.oldestCreatedAtMs),
          }
        : {}),
    });
  }

  /** Refreshes diagnostics only at serialized initialization/mutation checkpoints. */
  private async refreshQueueDiagnostics(force: boolean): Promise<void> {
    const observedAt = this.now();
    if (
      !force &&
      observedAt - this.lastQueueDiagnosticsAt < this.queueDiagnosticsIntervalMs
    ) {
      return;
    }
    this.lastQueueDiagnosticsAt = observedAt;
    const engine = this.engine;
    if (!engine || typeof engine.queueDiagnostics !== 'function') {
      this.recordCachedQueueDiagnostics();
      return;
    }

    const queueDiagnostics = engine.queueDiagnostics.bind(engine);
    let cancel!: () => void;
    const cancelled = new Promise<{ kind: 'cancelled' }>((resolve) => {
      cancel = () => resolve({ kind: 'cancelled' });
    });
    this.cancelQueueDiagnostics = cancel;
    const attempt = Promise.resolve()
      .then(() => queueDiagnostics())
      .then(
        (value) => ({ kind: 'result' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error })
      );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeout = setTimeout(
        () => resolve({ kind: 'timeout' }),
        this.queueDiagnosticsTimeoutMs
      );
    });

    try {
      const outcome = await Promise.race([attempt, timedOut, cancelled]);
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'timeout') {
        this.telemetry.record({
          name: 'graphql_cache.queue_diagnostics',
          operationCategory: 'queue',
          outcome: 'error',
          errorCode: 'timeout',
          queueDiagnosticsAvailability: this.latestQueueDiagnostics
            ? 'available'
            : 'unavailable',
        });
        return;
      }
      if (outcome.kind === 'error') {
        this.telemetry.record({
          name: 'graphql_cache.queue_diagnostics',
          operationCategory: 'queue',
          outcome: 'error',
          ...describeCacheError(outcome.error),
          queueDiagnosticsAvailability: this.latestQueueDiagnostics
            ? 'available'
            : 'unavailable',
        });
        return;
      }
      if (outcome.value.availability === 'unavailable') {
        this.recordCachedQueueDiagnostics();
        return;
      }

      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const depthInteger = BigInt(outcome.value.depth);
      const oldestInteger =
        outcome.value.oldestCreatedAtMs === null
          ? undefined
          : BigInt(outcome.value.oldestCreatedAtMs);
      this.latestQueueDiagnostics = {
        depth: Number(
          depthInteger < 0n
            ? 0n
            : depthInteger > maxSafe
              ? maxSafe
              : depthInteger
        ),
        ...(oldestInteger === undefined
          ? {}
          : {
              oldestCreatedAtMs: Number(
                oldestInteger > maxSafe
                  ? maxSafe
                  : oldestInteger < -maxSafe
                    ? -maxSafe
                    : oldestInteger
              ),
            }),
      };
      this.recordCachedQueueDiagnostics();
    } catch (error) {
      // Parsing a malformed diagnostic is an observation failure only.
      this.telemetry.record({
        name: 'graphql_cache.queue_diagnostics',
        operationCategory: 'queue',
        outcome: 'error',
        ...describeCacheError(error),
        queueDiagnosticsAvailability: this.latestQueueDiagnostics
          ? 'available'
          : 'unavailable',
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (this.cancelQueueDiagnostics === cancel) {
        this.cancelQueueDiagnostics = undefined;
      }
    }
  }

  /** Download/compile/instantiate without acquiring the database lock or opening OPFS. */
  async prepare(): Promise<void> {
    await loadCacheWasm();
  }

  private async init(scope: string, hotCapacity?: number): Promise<void> {
    if (this.initPromise) {
      // Subsequent page clients routed to this elected engine re-init idempotently.
      await this.initPromise;
      if (this.scope !== scope) {
        throw new Error(
          `cache worker already initialized for scope ${this.scope}, got ${scope}`
        );
      }
      if (this.hotCapacity !== hotCapacity) {
        throw new Error(
          `cache worker already initialized with hot capacity ${String(this.hotCapacity)}, got ${String(hotCapacity)}`
        );
      }
      return;
    }
    this.scope = scope;
    this.hotCapacity = hotCapacity;
    this.initPromise = (async () => {
      const wasm = await loadCacheWasm();
      let schemaStartedAt = this.now();
      const onOwnerLockAcquired = this.options.onOwnerLockAcquired;
      const onOwnerLockBusy = this.options.onOwnerLockBusy;
      let storageGrantRequested = false;
      const awaitStorageGrant = onOwnerLockAcquired
        ? async () => {
            storageGrantRequested = true;
            // Time the open itself, not the wait for another owner.
            schemaStartedAt = this.now();
            await onOwnerLockAcquired();
          }
        : undefined;
      try {
        let openOutcome: CacheOpenOutcome;
        if (awaitStorageGrant && onOwnerLockBusy) {
          const open = this.options.recoveryOpen
            ? wasm.openCacheForRecoveryWithOutcome
            : wasm.openCacheWithOutcome;
          // Checked before any open: an older artifact would queue for the
          // lock and touch storage without the coordinator's grant.
          if (!open || !wasm.cacheDatabaseIdentity) {
            throw new Error(
              'cache WASM predates storage-versioned databases; rebuild it'
            );
          }
          if (
            wasm.cacheDatabaseIdentity(scope) !== cacheDatabaseIdentity(scope)
          ) {
            throw new Error(
              'cache WASM storage version does not match this build'
            );
          }
          const opened = await this.openWhenOwnerLockIsFree(
            () => open(scope, hotCapacity, awaitStorageGrant, true),
            onOwnerLockBusy
          );
          this.engine = opened.engine;
          openOutcome = opened.outcome;
        } else if (this.options.recoveryOpen) {
          if (wasm.openCacheForRecoveryWithOutcome) {
            const opened = await wasm.openCacheForRecoveryWithOutcome(
              scope,
              hotCapacity,
              awaitStorageGrant
            );
            this.engine = opened.engine;
            openOutcome = opened.outcome;
          } else {
            this.engine = await wasm.openCacheForRecovery(scope, hotCapacity);
            openOutcome = 'reset-storage-uncertain';
          }
        } else if (wasm.openCacheWithOutcome) {
          const opened = await wasm.openCacheWithOutcome(
            scope,
            hotCapacity,
            awaitStorageGrant
          );
          this.engine = opened.engine;
          openOutcome = opened.outcome;
        } else {
          this.engine = await wasm.openCache(scope, hotCapacity);
          openOutcome = 'opened-existing';
        }
        if (awaitStorageGrant && !storageGrantRequested) {
          // A stale artifact opened storage without asking the coordinator.
          throw new Error('cache WASM does not support the owner-lock grant');
        }
        this.options.onInitializationOutcome?.(openOutcome);
        this.telemetry.record({
          name: 'graphql_cache.schema_init',
          operationCategory: 'initialization',
          outcome: 'success',
          errorCode: 'none',
          openOutcome,
          durationMs: this.now() - schemaStartedAt,
        });
        await this.refreshQueueDiagnostics(true);
      } catch (error) {
        this.telemetry.record({
          name: 'graphql_cache.schema_init',
          operationCategory: 'initialization',
          outcome: 'error',
          ...describeCacheError(error),
          durationMs: this.now() - schemaStartedAt,
        });
        throw error;
      }
    })();
    await this.initPromise;
  }

  private async openWhenOwnerLockIsFree(
    open: () => Promise<CacheOpenResult>,
    onOwnerLockBusy: (attempt: number) => Promise<void>
  ): Promise<CacheOpenResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await open();
      } catch (error) {
        if (!isOwnerLockUnavailable(error)) throw error;
        await onOwnerLockBusy(attempt);
      }
    }
  }

  private reportResetRequired(error: unknown): void {
    if (
      this.resetRequiredReported ||
      (typeof error !== 'object' && typeof error !== 'function') ||
      error === null ||
      !('cacheStorageResetRequired' in error) ||
      error.cacheStorageResetRequired !== true
    ) {
      return;
    }
    this.resetRequiredReported = true;
    this.options.onStorageResetRequired?.(
      error instanceof Error ? error : new Error('cache storage reset required')
    );
  }

  private resolveDrainWaitersIfIdle(): void {
    if (
      this.activeRequestHandlers > 0 ||
      this.running ||
      this.queue.length > 0
    ) {
      return;
    }
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }

  /** Notifies every page routed to this elected engine. */
  private fanOut(result: WriteResult, cacheChanged: boolean): void {
    if (result.affectedOps.length > 0) {
      this.push({
        kind: 'ops-affected',
        opIds: result.affectedOps,
        keys: result.changed,
        ...(result.fieldChanges === undefined
          ? {}
          : { fieldChanges: result.fieldChanges }),
      });
    }
    if (cacheChanged && result.revisionAdvanced) {
      this.push({
        kind: 'cache-changed',
        revision: result.revision,
        ...(!result.reset && result.searchChangedBuckets !== undefined
          ? { searchChangedBuckets: result.searchChangedBuckets }
          : {}),
        ...(result.reset ? { reset: true } : {}),
      });
    }
  }

  private push(msg: CachePush): void {
    for (const port of this.ports) {
      port.postMessage({
        ...msg,
        authorityGeneration: this.executingAuthority,
      });
    }
  }

  private requireEngine(): CacheEngine {
    if (!this.engine) {
      throw new Error('cache worker not initialized (send init first)');
    }
    return this.engine;
  }
}
