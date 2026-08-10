/**
 * SharedWorker core: owns the browser's single wasm engine, serves the RPC
 * protocol to page ports, and fans out invalidations.
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
import { type CacheEngine, loadCacheWasm } from './wasm-module';

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
  private readonly ports = new Set<PortLike>();

  addPort(port: PortLike): void {
    this.ports.add(port);
  }

  removePort(port: PortLike): void {
    this.ports.delete(port);
  }

  async handleRequest(port: PortLike, request: CacheRequest): Promise<void> {
    const respond = (response: CacheResponse) => port.postMessage(response);
    try {
      const result = await this.enqueue(request);
      respond({ id: request.id, ok: true, result });
    } catch (error) {
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
          this.drain();
          return;
        }
      }

      this.queue.push({
        request,
        priority,
        readSignature: signature,
        waiters: [{ resolve, reject }],
      });
      this.drain();
    });
  }

  /**
   * Runs the highest-priority request before the next lifecycle barrier.
   * Cache-view writes retain FIFO order with each other; overlapping reads
   * may observe the newer state, which is linearizable and avoids stale work.
   */
  private drain(): void {
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
        (result) => {
          for (const waiter of queued.waiters) waiter.resolve(result);
        },
        (error) => {
          for (const waiter of queued.waiters) waiter.reject(error);
        }
      )
      .finally(() => {
        this.running = false;
        this.drain();
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

  private async init(scope: string, hotCapacity?: number): Promise<void> {
    if (this.initPromise) {
      // Subsequent tabs connecting to the SharedWorker re-init idempotently.
      await this.initPromise;
      if (this.scope !== scope) {
        throw new Error(
          `cache worker already initialized for scope ${this.scope}, got ${scope}`
        );
      }
      return;
    }
    this.scope = scope;
    this.initPromise = (async () => {
      const wasm = await loadCacheWasm();
      this.engine = await wasm.openCache(scope, hotCapacity);
    })();
    await this.initPromise;
  }

  /** Notifies every page connected to this shared engine. */
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
