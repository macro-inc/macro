/**
 * Wire protocol between page contexts and the cache worker (the `CacheHost`
 * RPC from the design doc, apps/web/docs/graphql-normalized-cache-plan.md §4).
 *
 * The browser topology is one SharedWorker engine serving many page ports.
 * Platforms without SharedWorker support use a storage-free no-op host.
 *
 * Operation ids are strings of the form `"{clientId}:{urqlOperationKey}"` so
 * one shared engine can track operations from many tabs without collisions.
 */

export type ReadResult = { kind: 'hit'; data: unknown } | { kind: 'miss' };

export type QueryRevalidationWire = {
  query: string;
  operationName?: string;
  /** Canonical JSON object, kept as text in the durable queue. */
  variablesJson: string;
};

export type EmbeddedLinkPathSegment =
  | { field: string }
  | {
      listItem: {
        whereField: string;
        equals: string | number | boolean | null;
      };
    };

export type OptimisticLinkPatchWire = {
  /** Generated GraphQL operation used as the typed graph entrypoint. */
  query: string;
  operationName?: string;
  /** Variables for the entrypoint operation. */
  variablesJson: string;
  /** Response-key path beginning at the query root. */
  path: EmbeddedLinkPathSegment[];
  operation:
    | { kind: 'remove'; entityKey: string }
    | { kind: 'prependUnique'; entityKey: string };
};

export type CachedQueryInstanceWire = {
  variables: Record<string, unknown>;
  /** Selected value; omitted when the reconstructed query is a cache miss. */
  value?: unknown;
};

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
  /** Present on successful optimistic settlement; empty otherwise. */
  revalidations?: QueryRevalidationWire[];
};

/**
 * Result of installing an optimistic layer. `changed`/`affectedOps` reflect
 * *visible* (composed-view) changes — nothing is durable until the
 * transaction commits.
 */
export type OptimisticWriteResult = WriteResult & {
  /** Engine-assigned id; settle after claiming the queue head. */
  transactionId: string;
};

/** Claimed strict queue head, ready to be forwarded through urql. */
export type ClaimedMutation = {
  transactionId: string;
  leaseGeneration: string;
  query: string;
  operationName?: string;
  variables: Record<string, unknown>;
  /** Identity witness captured at enqueue time. */
  identity?: string;
  attemptCount: number;
};

/** Identifies the queue attempt allowed to settle a transaction. */
export type MutationClaim = {
  owner: string;
  generation: string;
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
  /** Durably enqueue a mutation together with its optimistic response. */
  | {
      kind: 'begin-optimistic-write';
      originOpId?: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      data: unknown;
      linkPatches?: OptimisticLinkPatchWire[];
      revalidations?: QueryRevalidationWire[];
      createdAtMs: number;
    }
  | {
      kind: 'claim-next-mutation';
      owner: string;
      nowMs: number;
      leaseExpiresAtMs: number;
    }
  | {
      kind: 'defer-optimistic-write';
      transactionId: string;
      leaseOwner: string;
      leaseGeneration: string;
      nextAttemptAtMs: number;
      error: string;
    }
  /** Atomically replace a claimed layer with the real network response. */
  | {
      kind: 'commit-optimistic-write';
      transactionId: string;
      leaseOwner: string;
      leaseGeneration: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      data: unknown;
    }
  /** Drop a claimed layer's contribution (permanent mutation failure). */
  | {
      kind: 'rollback-optimistic-write';
      transactionId: string;
      leaseOwner: string;
      leaseGeneration: string;
    }
  | {
      kind: 'inspect-query';
      query: string;
      operationName?: string;
      /** Response-key field path from the query root. */
      path: Array<{ field: string }>;
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
 * Fire-and-forget notice from a client to the worker (no id/response).
 * `disconnect` lets a SharedWorker drop the sender's port — there is no
 * platform event for client disconnection, so hosts send this on dispose
 * and pagehide.
 */
export type CacheNotice = { kind: 'disconnect' };

export function isCacheNotice(
  msg: CacheRequest | CacheNotice
): msg is CacheNotice {
  return msg.kind === 'disconnect';
}

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

export function isCachePush(msg: WorkerMessage): msg is CachePush {
  return 'kind' in msg && msg.kind === 'ops-affected';
}
