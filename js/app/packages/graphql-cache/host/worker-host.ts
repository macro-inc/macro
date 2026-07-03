/**
 * Browser CacheHost: talks the RPC protocol to the cache worker.
 * Prefers SharedWorker (single engine across tabs); falls back to a
 * dedicated worker per tab (engines converge via IndexedDB + Web Locks +
 * BroadcastChannel — see worker-core.ts).
 */

import {
  type CacheRequest,
  isCachePush,
  type ReadResult,
  type WorkerMessage,
  type WriteResult,
} from '../protocol';
import type { CacheHost, CacheReadArgs, CacheWriteArgs } from './types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** `Omit` that distributes over union members. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface WorkerHostOptions {
  scope: string;
  hotCapacity?: number;
  /** Force a topology (tests/diagnostics). */
  forceDedicatedWorker?: boolean;
}

export function createWorkerCacheHost(options: WorkerHostOptions): CacheHost {
  const clientId = crypto.randomUUID();
  const pending = new Map<number, Pending>();
  const affectedSubscribers = new Set<(opKeys: number[]) => void>();
  let nextRequestId = 1;

  const useShared =
    typeof SharedWorker === 'function' && !options.forceDedicatedWorker;

  let post: (msg: CacheRequest) => void;
  let dispose: () => void;

  const onMessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (isCachePush(msg)) {
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
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(msg.error));
    }
  };

  if (useShared) {
    const worker = new SharedWorker(
      new URL('../worker/cache.shared-worker.ts', import.meta.url),
      { type: 'module', name: `graphql-cache:${options.scope}` }
    );
    worker.port.onmessage = onMessage;
    worker.port.start();
    post = (msg) => worker.port.postMessage(msg);
    dispose = () => worker.port.close();
  } else {
    const worker = new Worker(
      new URL('../worker/cache.worker.ts', import.meta.url),
      { type: 'module', name: `graphql-cache:${options.scope}` }
    );
    worker.onmessage = onMessage;
    post = (msg) => worker.postMessage(msg);
    dispose = () => worker.terminate();
  }

  function request(
    msg: DistributiveOmit<CacheRequest, 'id'>
  ): Promise<unknown> {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ ...msg, id } as CacheRequest);
    });
  }

  const ready = request({
    kind: 'init',
    scope: options.scope,
    hotCapacity: options.hotCapacity,
  });

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

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      await ready;
      return (await request({
        kind: 'write',
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
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

    dispose,
  };
}
