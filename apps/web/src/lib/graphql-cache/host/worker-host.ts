/**
 * Browser CacheHost: talks to the single cache engine in a SharedWorker.
 * Platforms without SharedWorker support receive a storage-free no-op host.
 */

import {
  type CachedQueryInstanceWire,
  type CacheNotice,
  type CacheRequest,
  type ClaimedMutation,
  isCachePush,
  type MutationClaim,
  type MutationSettlement,
  type OptimisticWriteResult,
  type ReadRecordsArgs,
  type ReadResult,
  type SelectedRecordPageWire,
  validateRecordSelectionLimit,
  type WorkerMessage,
  type WriteResult,
} from '../protocol';
import { createNoopCacheHost } from './noop-host';
import type {
  BeginOptimisticWriteArgs,
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
  InspectQueryArgs,
} from './types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/** `Omit` that distributes over union members. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface WorkerHostOptions {
  scope: string;
  hotCapacity?: number;
  /**
   * Read-only request timeout in ms (default 10s). A hung worker rejects
   * cache reads; mutating requests remain pending so callers cannot retry an
   * operation that may already have completed durably.
   */
  requestTimeoutMs?: number;
  /** Reports an asynchronous durable-storage initialization failure. */
  onInitializationError?: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createWorkerCacheHost(options: WorkerHostOptions): CacheHost {
  if (typeof SharedWorker !== 'function') {
    return createNoopCacheHost('SharedWorker is not supported by this browser');
  }

  const clientId = crypto.randomUUID();
  const pending = new Map<number, Pending>();
  const affectedSubscribers = new Set<(opKeys: number[]) => void>();
  const cacheChangeSubscribers = new Set<() => void>();
  const settlementSubscribers = new Set<
    (settlement: MutationSettlement) => void
  >();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let nextRequestId = 1;

  let post: (msg: CacheRequest) => void;
  let dispose: () => void;

  const onMessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (isCachePush(msg)) {
      if (msg.kind === 'cache-changed') {
        for (const cb of cacheChangeSubscribers) cb();
        return;
      }
      if (msg.kind === 'mutation-settled') {
        for (const cb of settlementSubscribers) cb(msg.settlement);
        return;
      }
      const prefix = `${clientId}:`;
      const opKeys = msg.opIds
        .filter((id) => id.startsWith(prefix))
        .map((id) => Number(id.slice(prefix.length)))
        .filter((n) => Number.isFinite(n));
      if (opKeys.length > 0) {
        for (const cb of affectedSubscribers) cb(opKeys);
      }
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(msg.error));
    }
  };

  let worker: SharedWorker;
  try {
    worker = new SharedWorker(
      new URL('../worker/cache.shared-worker.ts', import.meta.url),
      { type: 'module', name: `graphql-cache:${options.scope}` }
    );
    worker.port.onmessage = onMessage;
    worker.port.start();
  } catch {
    return createNoopCacheHost('SharedWorker could not be initialized');
  }
  post = (msg) => worker.port.postMessage(msg);
  dispose = () => {
    // Tell the SharedWorker to drop our port — there is no platform
    // disconnect event, and stale ports would otherwise accumulate.
    const notice: CacheNotice = { kind: 'disconnect' };
    worker.port.postMessage(notice);
    worker.port.close();
  };

  // Best-effort cleanup when the page goes away (bfcache-safe: a restored
  // page gets a fresh host on next use anyway).
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', dispose, { once: true });
  }

  function request(
    msg: DistributiveOmit<CacheRequest, 'id'>
  ): Promise<unknown> {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (
        msg.kind === 'read' ||
        msg.kind === 'read-records' ||
        msg.kind === 'inspect-query'
      ) {
        entry.timer = setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`cache worker timeout: ${msg.kind}`));
          }
        }, requestTimeoutMs);
      }
      pending.set(id, entry);
      post({ ...msg, id } as CacheRequest);
    });
  }

  const ready = request({
    kind: 'init',
    scope: options.scope,
    hotCapacity: options.hotCapacity,
  });
  void (async () => {
    try {
      await ready;
    } catch (error) {
      options.onInitializationError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  })();

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      await ready;
      return (await request({
        kind: 'read',
        opId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
      })) as ReadResult;
    },

    async readRecords(args: ReadRecordsArgs): Promise<SelectedRecordPageWire> {
      const limit = validateRecordSelectionLimit(args.limit);
      await ready;
      return (await request({
        kind: 'read-records',
        document: args.document,
        fragmentName: args.fragmentName,
        cursor: args.cursor,
        limit,
      })) as SelectedRecordPageWire;
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      await ready;
      return (await request({
        kind: 'write',
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      })) as WriteResult;
    },

    async beginOptimisticWrite(
      args: BeginOptimisticWriteArgs
    ): Promise<OptimisticWriteResult> {
      await ready;
      return (await request({
        kind: 'begin-optimistic-write',
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        linkPatches: args.linkPatches,
        revalidations: args.revalidations,
        createdAtMs: Date.now(),
      })) as OptimisticWriteResult;
    },

    async inspectQuery(
      args: InspectQueryArgs
    ): Promise<CachedQueryInstanceWire[]> {
      await ready;
      return (await request({
        kind: 'inspect-query',
        query: args.query,
        operationName: args.operationName,
        path: args.path,
      })) as CachedQueryInstanceWire[];
    },

    async claimNextMutation(
      owner: string,
      nowMs: number,
      leaseExpiresAtMs: number
    ): Promise<ClaimedMutation | undefined> {
      await ready;
      return (await request({
        kind: 'claim-next-mutation',
        owner,
        nowMs,
        leaseExpiresAtMs,
      })) as ClaimedMutation | undefined;
    },

    async deferOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      nextAttemptAtMs: number,
      error: string
    ): Promise<void> {
      await ready;
      await request({
        kind: 'defer-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        nextAttemptAtMs,
        error,
      });
    },

    async commitOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      args: CacheWriteArgs
    ): Promise<WriteResult> {
      await ready;
      return (await request({
        kind: 'commit-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
      })) as WriteResult;
    },

    async rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string
    ): Promise<WriteResult> {
      await ready;
      return (await request({
        kind: 'rollback-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        error,
      })) as WriteResult;
    },

    async invalidate(keys: string[]): Promise<string[]> {
      await ready;
      return (await request({ kind: 'invalidate', keys })) as string[];
    },

    async teardown(opKey: number): Promise<void> {
      await ready;
      await request({ kind: 'teardown', opId: opId(opKey) });
    },

    async clear(): Promise<void> {
      await ready;
      await request({ kind: 'clear' });
    },

    onOpsAffected(cb: (opKeys: number[]) => void): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    onCacheChanged(cb: () => void): () => void {
      cacheChangeSubscribers.add(cb);
      return () => cacheChangeSubscribers.delete(cb);
    },

    onMutationSettled(
      cb: (settlement: MutationSettlement) => void
    ): () => void {
      settlementSubscribers.add(cb);
      return () => settlementSubscribers.delete(cb);
    },

    dispose() {
      affectedSubscribers.clear();
      cacheChangeSubscribers.clear();
      settlementSubscribers.clear();
      dispose();
    },
  };
}
