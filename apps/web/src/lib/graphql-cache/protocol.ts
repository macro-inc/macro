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

/** Soup entity buckets persisted by the normalized-cache secondary index. */
export type IndexedEntityBucket =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'channel'
  | 'crm_company';

/** Opaque exclusive cursor for deterministic indexed pagination. */
export type EntityIndexCursor = string;
/** Opaque cursor for relevance-ordered indexed search. */
export type EntitySearchCursor = string;

/** Cache-only indexed entity snapshot. Normalized record links are omitted. */
export type IndexedEntityItem = {
  id: string;
  bucket: IndexedEntityBucket;
  sortTimestamp: number;
  entity: Record<string, unknown>;
};

/** One deterministic page from the normalized-record secondary index. */
export type IndexedEntityPage = {
  items: IndexedEntityItem[];
  nextCursor: EntityIndexCursor | null;
  hasMore: boolean;
  /** Present only when requested, normally on the first page. */
  totalCount: number | null;
  /** Per-entity-type totals, present alongside `totalCount`. */
  bucketCounts?: Partial<Record<IndexedEntityBucket, number>> | null;
};

export const MAX_INDEXED_ENTITY_PAGE_SIZE = 500;

export type QueryIndexedItemsArgs = {
  /** Empty or omitted means every indexed entity bucket. */
  buckets?: IndexedEntityBucket[];
  cursor?: EntityIndexCursor;
  limit: number;
  /** Request a bucket-wide count without hydrating additional records. */
  includeTotalCount?: boolean;
};

export type IndexedEntitySearchPage = {
  items: IndexedEntityItem[];
  nextCursor: EntitySearchCursor | null;
  hasMore: boolean;
  totalCount: number | null;
  /** Per-entity-type match totals, present alongside `totalCount`. */
  bucketCounts?: Partial<Record<IndexedEntityBucket, number>> | null;
};

export type SearchIndexedItemsArgs = {
  /** Empty or omitted means every indexed entity bucket. */
  buckets?: IndexedEntityBucket[];
  query: string;
  cursor?: EntitySearchCursor;
  limit: number;
  includeTotalCount?: boolean;
};

/** Validates and clamps an indexed page size before crossing a host boundary. */
export function normalizeIndexedEntityLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('indexed entity limit must be a non-negative integer');
  }
  return Math.min(limit, MAX_INDEXED_ENTITY_PAGE_SIZE);
}

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
      kind: 'query-indexed-items';
      buckets: IndexedEntityBucket[];
      cursor?: EntityIndexCursor;
      limit: number;
      includeTotalCount: boolean;
    }
  | {
      kind: 'search-indexed-items';
      buckets: IndexedEntityBucket[];
      query: string;
      cursor?: EntitySearchCursor;
      limit: number;
      includeTotalCount: boolean;
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
export type CachePush =
  | {
      kind: 'ops-affected';
      opIds: string[];
      /** Changed entity keys, for diagnostics/advanced consumers. */
      keys: string[];
    }
  | {
      kind: 'entity-index-changed';
    };

export type WorkerMessage = CacheResponse | CachePush;

export function isCachePush(msg: WorkerMessage): msg is CachePush {
  return (
    'kind' in msg &&
    (msg.kind === 'ops-affected' || msg.kind === 'entity-index-changed')
  );
}
