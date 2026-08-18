/**
 * Dedicated engine-worker core: owns the elected browser WASM engine, serves
 * coordinator-routed RPCs, and fans out invalidations.
 */

import { match } from 'ts-pattern';
import type {
  CachePush,
  CacheRequest,
  CacheResponse,
  EnqueueOptimisticMutationResult,
  ReadResult,
  SelectedRecordPageWire,
  WriteResult,
} from '../protocol';
import {
  type CacheTelemetryRecorderLike,
  classifyCacheError,
  isolateCacheTelemetry,
  isStorageTransactionRequest,
  operationCategoryForRequest,
} from '../telemetry';
import {
  type CacheEngine,
  type CacheOpenOutcome,
  loadCacheWasm,
} from './wasm-module';

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
};

export interface CacheWorkerCoreOptions {
  /** Atomically recovery-wipes before any Turso open during initialization. */
  recoveryOpen?: boolean;
  /** Called once when WASM latches a reset-required storage failure. */
  onStorageResetRequired?: (error: Error) => void;
  /** Reports the bounded open outcome to the coordinator transport. */
  onInitializationOutcome?: (outcome: CacheOpenOutcome) => void;
  telemetry?: CacheTelemetryRecorderLike;
  /** Injectable clocks and cadence for payload-free diagnostics tests. */
  monotonicNow?: () => number;
  wallClockNow?: () => number;
  queueDiagnosticsIntervalMs?: number;
  queueDiagnosticsTimeoutMs?: number;
}

const NORMAL_READ_PRIORITY = 0;
const USER_VISIBLE_READ_PRIORITY = 1;
const CACHE_WRITE_PRIORITY = 2;

/** Reads may reorder while they overlap, but never across lifecycle barriers. */
function isOrderingBarrier(request: CacheRequest): boolean {
  return (
    request.kind === 'init' ||
    request.kind === 'teardown' ||
    request.kind === 'clear'
  );
}

function requestPriority(request: CacheRequest): number {
  if (request.kind === 'read') {
    return request.priority === 'user-visible'
      ? USER_VISIBLE_READ_PRIORITY
      : NORMAL_READ_PRIORITY;
  }
  if (
    request.kind === 'write' ||
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
    request.opId,
    request.query,
    request.operationName ?? null,
    request.variables ?? null,
    request.entityResolvers ?? null,
  ]);
}

export class CacheWorkerCore {
  private engine: CacheEngine | undefined;
  private initPromise: Promise<void> | undefined;
  private scope: string | undefined;
  /** Serializes engine calls while allowing safe read prioritization. */
  private readonly queue: QueuedEngineRequest[] = [];
  private running = false;
  private acceptingRequests = true;
  private activeRequestHandlers = 0;
  private readonly drainWaiters = new Set<() => void>();
  private resetRequiredReported = false;
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
      const result = await this.enqueue(request);
      const durationMs = this.now() - startedAt;
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
        request.kind === 'write' &&
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
      respond({ id: request.id, ok: true, result });
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

  private enqueue(request: CacheRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const priority = requestPriority(request);
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
          this.drainQueue();
          return;
        }
      }

      this.queue.push({
        request,
        priority,
        readSignature: signature,
        waiters: [{ resolve, reject }],
      });
      this.drainQueue();
    });
  }

  /**
   * Runs the highest-priority request before the next lifecycle barrier.
   * Cache-view writes retain FIFO order with each other; overlapping reads
   * may observe the newer state, which is linearizable and avoids stale work.
   */
  private drainQueue(): void {
    if (this.running || this.queue.length === 0) return;

    let segmentEnd = this.queue.findIndex((queued) =>
      isOrderingBarrier(queued.request)
    );
    if (segmentEnd === -1) segmentEnd = this.queue.length;

    let index = 0;
    if (segmentEnd > 0) {
      for (let i = 1; i < segmentEnd; i += 1) {
        const candidate = this.queue[i];
        const selected = this.queue[index];
        if (candidate && selected && candidate.priority > selected.priority) {
          index = i;
        }
      }
    }

    const [queued] = this.queue.splice(index, 1);
    if (!queued) return;
    this.running = true;
    void this.dispatch(queued.request)
      .then(
        async (result) => {
          // Resolve the cache result before the bounded observation checkpoint.
          for (const waiter of queued.waiters) waiter.resolve(result);
          if (isStorageTransactionRequest(queued.request)) {
            await this.refreshQueueDiagnostics(false);
          }
        },
        (error) => {
          for (const waiter of queued.waiters) waiter.reject(error);
        }
      )
      .finally(() => {
        this.running = false;
        this.drainQueue();
        this.resolveDrainWaitersIfIdle();
      });
  }

  private async dispatch(request: CacheRequest): Promise<unknown> {
    return await match(request)
      .with({ kind: 'init' }, async (request) => {
        await this.init(request.scope, request.hotCapacity);
        return null;
      })
      .with({ kind: 'read' }, async (request) => {
        const engine = this.requireEngine();
        const result: ReadResult = await engine.readQuery(
          request.opId,
          request.query,
          request.operationName,
          request.variables,
          request.entityResolvers
        );
        return result;
      })
      .with({ kind: 'read-records' }, async (request) => {
        const engine = this.requireEngine();
        const result: SelectedRecordPageWire = await engine.readRecords(
          request.document,
          request.fragmentName,
          request.cursor,
          request.limit
        );
        return result;
      })
      .with({ kind: 'write' }, async (request) => {
        const engine = this.requireEngine();
        const result = await engine.writeQuery(
          request.originOpId,
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.identity
        );
        this.fanOut(result, true);
        return result;
      })
      .with({ kind: 'enqueue-optimistic-mutation' }, async (request) => {
        const engine = this.requireEngine();
        const result: EnqueueOptimisticMutationResult =
          await engine.enqueueOptimisticMutation(
            request.originOpId,
            request.query,
            request.operationName,
            request.variables,
            request.data,
            request.linkPatches,
            request.revalidations,
            request.createdAtMs,
            request.owner,
            request.nowMs,
            request.leaseExpiresAtMs
          );
        this.fanOut(result, true);
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
          request.variableFilters ?? []
        );
      })
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
        await engine.deferOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration,
          request.nextAttemptAtMs,
          request.error
        );
        return null;
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
          request.data
        );
        this.fanOut(result, true);
        this.push({
          kind: 'mutation-settled',
          settlement: {
            transactionId: request.transactionId,
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
        this.fanOut(result, true);
        this.push({
          kind: 'mutation-settled',
          settlement: {
            transactionId: request.transactionId,
            status: 'permanently-failed',
            error: request.error,
          },
        });
        return result;
      })
      .with({ kind: 'invalidate' }, async (request) => {
        const engine = this.requireEngine();
        const affectedOps = await engine.invalidateKeys(request.keys);
        this.fanOut(
          {
            changed: request.keys,
            affectedOps,
            reset: false,
            revalidations: [],
          },
          true
        );
        return affectedOps;
      })
      .with({ kind: 'delete-records' }, async (request) => {
        const engine = this.requireEngine();
        const affectedOps = await engine.deleteKeys(request.keys);
        this.fanOut(
          {
            changed: request.keys,
            affectedOps,
            reset: false,
            revalidations: [],
          },
          true
        );
        return affectedOps;
      })
      .with({ kind: 'teardown' }, async (request) => {
        await this.requireEngine().teardownOperation(request.opId);
        return null;
      })
      .with({ kind: 'clear' }, async () => {
        await this.requireEngine().clear();
        this.push({ kind: 'cache-changed' });
        return null;
      })
      .exhaustive();
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
          errorCode: classifyCacheError(outcome.error),
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
        errorCode: classifyCacheError(error),
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
      const schemaStartedAt = this.now();
      try {
        let openOutcome: CacheOpenOutcome;
        if (this.options.recoveryOpen) {
          if (wasm.openCacheForRecoveryWithOutcome) {
            const opened = await wasm.openCacheForRecoveryWithOutcome(
              scope,
              hotCapacity
            );
            this.engine = opened.engine;
            openOutcome = opened.outcome;
          } else {
            this.engine = await wasm.openCacheForRecovery(scope, hotCapacity);
            openOutcome = 'reset-storage-uncertain';
          }
        } else if (wasm.openCacheWithOutcome) {
          const opened = await wasm.openCacheWithOutcome(scope, hotCapacity);
          this.engine = opened.engine;
          openOutcome = opened.outcome;
        } else {
          this.engine = await wasm.openCache(scope, hotCapacity);
          openOutcome = 'opened-existing';
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
          errorCode: classifyCacheError(error),
          durationMs: this.now() - schemaStartedAt,
        });
        throw error;
      }
    })();
    await this.initPromise;
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
      });
    }
    if (cacheChanged) {
      this.push({ kind: 'cache-changed' });
    }
  }

  private push(msg: CachePush): void {
    for (const port of this.ports) {
      port.postMessage(msg);
    }
  }

  private requireEngine(): CacheEngine {
    if (!this.engine) {
      throw new Error('cache worker not initialized (send init first)');
    }
    return this.engine;
  }
}
