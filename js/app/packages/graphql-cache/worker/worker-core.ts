/**
 * Topology-agnostic worker core: owns the wasm engine, serves the RPC
 * protocol on one or more ports, and fans out invalidations.
 *
 * Used by both entries:
 * - cache.shared-worker.ts (SharedWorker, many ports, one engine)
 * - cache.worker.ts (dedicated worker per tab + BroadcastChannel + Web Locks)
 */

import {
  broadcastChannelName,
  type CacheBroadcast,
  type CachePush,
  type CacheRequest,
  type CacheResponse,
  type ReadResult,
  type WriteResult,
  writeLockName,
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
  private broadcast: BroadcastChannel | undefined;
  private readonly workerId = crypto.randomUUID();

  constructor(
    private readonly options: {
      /**
       * Fallback topology (dedicated worker per tab): serialize writes via
       * Web Locks and exchange changed keys over BroadcastChannel.
       */
      multiEngine: boolean;
    }
  ) {}

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
        const write = async (): Promise<WriteResult> =>
          await engine.writeQuery(
            request.originOpId,
            request.query,
            request.operationName,
            request.variables,
            request.data
          );
        const result =
          this.options.multiEngine && this.scope
            ? await navigator.locks.request(writeLockName(this.scope), write)
            : await write();
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
      if (this.options.multiEngine) {
        this.broadcast = new BroadcastChannel(broadcastChannelName(scope));
        this.broadcast.onmessage = (event: MessageEvent<CacheBroadcast>) => {
          void this.onBroadcast(event.data);
        };
      }
    })();
    await this.initPromise;
  }

  /** Broadcasts from other tabs' engines sharing our storage. */
  private async onBroadcast(msg: CacheBroadcast): Promise<void> {
    if (msg.source === this.workerId) return;
    const engine = this.engine;
    if (!engine) return;
    if (msg.kind === 'reset') {
      // Another engine wiped the shared storage (identity change): drop
      // local in-memory state and re-execute everything we track.
      const affectedOps = await this.enqueue(() => engine.externalReset());
      this.push({ kind: 'ops-affected', opIds: affectedOps, keys: [] });
      return;
    }
    const affectedOps = await this.enqueue(() =>
      engine.invalidateKeys(msg.keys)
    );
    this.push({ kind: 'ops-affected', opIds: affectedOps, keys: msg.keys });
  }

  /** After a local change: notify connected clients + other tabs. */
  private fanOut(result: WriteResult): void {
    if (result.changed.length === 0 && !result.reset) return;
    if (result.affectedOps.length > 0) {
      this.push({
        kind: 'ops-affected',
        opIds: result.affectedOps,
        keys: result.changed,
      });
    }
    if (this.options.multiEngine && this.broadcast) {
      const msg: CacheBroadcast = result.reset
        ? { kind: 'reset', source: this.workerId }
        : { kind: 'changed', keys: result.changed, source: this.workerId };
      this.broadcast.postMessage(msg);
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
