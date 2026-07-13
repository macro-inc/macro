/**
 * Tauri CacheHost: talks to the native cache engine living in the Tauri
 * host process (graphql_cache_plugin) over invoke commands. The host
 * process is the single shared engine instance across all webviews/windows
 * (SharedWorker semantics); change pushes arrive as a broadcast tauri event
 * that every webview filters by its own clientId prefix — mirroring
 * worker-host.ts.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from '../protocol';
import type { CacheHost, CacheReadArgs, CacheWriteArgs } from './types';

/** Keep in sync with `OPS_AFFECTED_EVENT` in graphql_cache_plugin. */
const OPS_AFFECTED_EVENT = 'graphql-cache://ops-affected';

/** Payload of the ops-affected event (graphql_cache_plugin `OpsAffectedEvent`). */
type OpsAffectedPayload = {
  opIds: string[];
  keys: string[];
};

export interface TauriHostOptions {
  scope: string;
  hotCapacity?: number;
  /**
   * Per-request timeout in ms (default 10s, matching worker-host). A hung
   * IPC call rejects; the exchange degrades rejected reads to the network.
   */
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createTauriCacheHost(options: TauriHostOptions): CacheHost {
  const clientId = crypto.randomUUID();
  const affectedSubscribers = new Set<(opKeys: number[]) => void>();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  function request<T>(
    command: string,
    args: Record<string, unknown>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`graphql cache ipc timeout: ${command}`));
      }, requestTimeoutMs);
      invoke<T>(command, args).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          // Command errors cross the boundary as strings; normalize to
          // Error for parity with worker-host rejections.
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  const unlisten: Promise<UnlistenFn> = listen<OpsAffectedPayload>(
    OPS_AFFECTED_EVENT,
    (event) => {
      const prefix = `${clientId}:`;
      const opKeys = event.payload.opIds
        .filter((id) => id.startsWith(prefix))
        .map((id) => Number(id.slice(prefix.length)))
        .filter((n) => Number.isFinite(n));
      if (opKeys.length > 0) {
        for (const cb of affectedSubscribers) cb(opKeys);
      }
    }
  );

  const ready = request('graphql_cache_init', {
    scope: options.scope,
    hotCapacity: options.hotCapacity,
  });

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      await ready;
      return await request<ReadResult>('graphql_cache_read', {
        opId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
      });
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>('graphql_cache_write', {
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      });
    },

    async beginOptimisticWrite(
      args: CacheWriteArgs
    ): Promise<OptimisticWriteResult> {
      await ready;
      return await request<OptimisticWriteResult>(
        'graphql_cache_begin_optimistic_write',
        {
          originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
        }
      );
    },

    async commitOptimisticWrite(
      transactionId: string,
      args: CacheWriteArgs
    ): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>(
        'graphql_cache_commit_optimistic_write',
        {
          transactionId,
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
        }
      );
    },

    async rollbackOptimisticWrite(transactionId: string): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>(
        'graphql_cache_rollback_optimistic_write',
        { transactionId }
      );
    },

    async invalidate(keys: string[]): Promise<string[]> {
      await ready;
      return await request<string[]>('graphql_cache_invalidate', { keys });
    },

    async teardown(opKey: number): Promise<void> {
      await ready;
      await request('graphql_cache_teardown', { opId: opId(opKey) });
    },

    async clear(): Promise<void> {
      await ready;
      await request('graphql_cache_clear', {});
    },

    onOpsAffected(cb: (opKeys: number[]) => void): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    dispose() {
      affectedSubscribers.clear();
      void unlisten.then((fn) => fn());
    },
  };
}
