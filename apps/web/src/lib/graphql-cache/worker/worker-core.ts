/**
 * SharedWorker core: owns the browser's single wasm engine, serves the RPC
 * protocol to page ports, and fans out invalidations.
 */

import type {
  CachePush,
  CacheRequest,
  CacheResponse,
  OptimisticWriteResult,
  ReadResult,
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
    switch (request.kind) {
      case 'init': {
        await this.init(request.scope, request.hotCapacity);
        return null;
      }
      case 'read': {
        const engine = this.requireEngine();
        const result: ReadResult = await engine.readQuery(
          request.opId,
          request.query,
          request.operationName,
          request.variables
        );
        return result;
      }
      case 'write': {
        const engine = this.requireEngine();
        const result = await engine.writeQuery(
          request.originOpId,
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.identity
        );
        this.fanOut(result);
        return result;
      }
      case 'begin-optimistic-write': {
        const engine = this.requireEngine();
        const result: OptimisticWriteResult = await engine.beginOptimisticWrite(
          request.originOpId,
          request.query,
          request.operationName,
          request.variables,
          request.data,
          request.createdAtMs
        );
        this.fanOut(result);
        return result;
      }
      case 'claim-next-mutation': {
        const engine = this.requireEngine();
        return await engine.claimNextMutation(
          request.owner,
          request.nowMs,
          request.leaseExpiresAtMs
        );
      }
      case 'defer-optimistic-write': {
        const engine = this.requireEngine();
        await engine.deferOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration,
          request.nextAttemptAtMs,
          request.error
        );
        return null;
      }
      case 'commit-optimistic-write': {
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
        this.fanOut(result);
        return result;
      }
      case 'rollback-optimistic-write': {
        const engine = this.requireEngine();
        const result = await engine.rollbackOptimisticWrite(
          request.transactionId,
          request.leaseOwner,
          request.leaseGeneration
        );
        this.fanOut(result);
        return result;
      }
      case 'invalidate': {
        const engine = this.requireEngine();
        const affectedOps = await engine.invalidateKeys(request.keys);
        this.fanOut({ changed: request.keys, affectedOps, reset: false });
        return affectedOps;
      }
      case 'teardown': {
        await this.requireEngine().teardownOperation(request.opId);
        return null;
      }
      case 'clear': {
        await this.requireEngine().clear();
        return null;
      }
      default: {
        // Compile-time exhaustiveness: a new request kind fails here.
        return request satisfies never;
      }
    }
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
  private fanOut(result: WriteResult): void {
    if (result.affectedOps.length > 0) {
      this.push({
        kind: 'ops-affected',
        opIds: result.affectedOps,
        keys: result.changed,
      });
    }
  }

  private push(msg: CachePush): void {
    if (msg.opIds.length === 0) return;
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
