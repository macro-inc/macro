/**
 * Wire protocol between page contexts and the cache worker (the `CacheHost`
 * RPC from the design doc, js/app/docs/graphql-normalized-cache-plan.md §4).
 *
 * Topologies:
 * - SharedWorker: one engine, many ports. Invalidations fan out over the
 *   ports directly.
 * - Dedicated worker per tab (fallback): one engine per tab over the same
 *   IndexedDB database. Writes are serialized with Web Locks; changed keys
 *   fan out across tabs via BroadcastChannel, and each tab's worker
 *   translates them into locally-affected operation ids.
 *
 * Operation ids are strings of the form `"{clientId}:{urqlOperationKey}"` so
 * one shared engine can track operations from many tabs without collisions.
 */

export type ReadResult = { kind: 'hit'; data: unknown } | { kind: 'miss' };

export type WriteResult = {
  /** Entity keys whose records changed. */
  changed: string[];
  /** Registered operation ids affected by the change (origin excluded). */
  affectedOps: string[];
  /**
   * True when the identity witness observed a different user and the cache
   * silently restarted (wiped + rebound) before this write. `affectedOps`
   * then contains every registered operation except the origin.
   */
  reset: boolean;
};

export type CacheRequest = { id: number } & (
  | { kind: 'init'; scope: string; hotCapacity?: number }
  | {
      kind: 'read';
      opId?: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
    }
  | {
      kind: 'write';
      originOpId?: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      data: unknown;
      /**
       * Opaque session tag (e.g. viewer id extracted from the response). A
       * write tagged with a different identity than the cache's bound one
       * wipes and rebinds the cache atomically (silent restart).
       */
      identity?: string;
    }
  | { kind: 'teardown'; opId: string }
  /** External invalidation (e.g. websocket push): evict + report ops. */
  | { kind: 'invalidate'; keys: string[] }
  | { kind: 'clear' }
);

export type CacheResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/**
 * Pushed (not request/response) messages from worker to its client(s):
 * operations whose underlying records changed. The host filters by its own
 * clientId prefix and re-executes.
 */
export type CachePush = {
  kind: 'ops-affected';
  opIds: string[];
  /** Changed entity keys, for diagnostics/advanced consumers. */
  keys: string[];
};

export type WorkerMessage = CacheResponse | CachePush;

/** Cross-tab broadcast (fallback topology), channel `graphql-cache:{scope}`. */
export type CacheBroadcast =
  | {
      kind: 'changed';
      keys: string[];
      /** Random id of the emitting worker, to ignore own broadcasts. */
      source: string;
    }
  | {
      /** The shared storage was wiped (identity change silent restart). */
      kind: 'reset';
      source: string;
    };

export function broadcastChannelName(scope: string): string {
  return `graphql-cache:${scope}`;
}

export function writeLockName(scope: string): string {
  return `graphql-cache:write:${scope}`;
}

export function isCachePush(msg: WorkerMessage): msg is CachePush {
  return 'kind' in msg && msg.kind === 'ops-affected';
}
