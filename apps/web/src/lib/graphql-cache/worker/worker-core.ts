/**
 * SharedWorker core: owns the browser's single wasm engine, serves the RPC
 * protocol to page ports, and fans out invalidations.
 */

import { match } from 'ts-pattern';
import type {
  CachePush,
  CacheRequest,
  CacheResponse,
  OptimisticWriteResult,
  ReadResult,
  SelectedRecordPageWire,
  WriteResult,
} from '../protocol';
import { type CacheEngine, loadCacheWasm } from './wasm-module';

type PortLike = {
  postMessage(msg: unknown): void;
};

export class CacheWorkerCore {
  private engine: CacheEngine | undefined;
  private initPromise: Promise<void> | undefined;
  private scope: string | undefined;
  /** Serializes engine calls (defense in depth; the engine also locks). */
  private queue: Promise<unknown> = Promise.resolve();
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
      const result = await this.enqueue(() => this.dispatch(request));
      respond({ id: request.id, ok: true, result });
    } catch (error) {
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
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
          request.variables
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
      .with({ kind: 'begin-optimistic-write' }, async (request) => {
        const engine = this.requireEngine();
        const result: OptimisticWriteResult = await engine.beginOptimisticWrite(
          request.originOpId,
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.linkPatches,
          request.revalidations,
          request.createdAtMs
        );
        this.fanOut(result, true);
        return result;
      })
      .with({ kind: 'inspect-query' }, async (request) => {
        return await this.requireEngine().inspectQuery(
          request.query,
          request.operationName,
          request.path
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
