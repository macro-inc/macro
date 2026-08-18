import type { EntityResolverWire } from './exchange/entity-resolvers';

/**
 * Wire protocol between page contexts and the cache worker (the `CacheHost`
 * RPC from the design doc, apps/web/docs/graphql-normalized-cache-plan.md §4).
 *
 * The browser topology routes page ports through a SharedWorker coordinator
 * to one elected DedicatedWorker engine. Platforms missing the required
 * coordinator capabilities use a storage-free no-op host.
 *
 * Operation ids are strings of the form `"{clientId}:{urqlOperationKey}"` so
 * one shared engine can track operations from many tabs without collisions.
 */

export type ReadResult = { kind: 'hit'; data: unknown } | { kind: 'miss' };

/** Scheduling hint for latency-sensitive cache reads. */
export type CacheReadPriority = 'user-visible';

/** Recursive partial-variable object used to limit query inspection work. */
export type QueryVariableFilter = Record<string, unknown>;

/** Opaque exclusive cursor for deterministic normalized-record scans. */
export type RecordCursor = string;

/** Untyped wire page returned by cache hosts. */
export type SelectedRecordPageWire = {
  records: unknown[];
  nextCursor: RecordCursor | null;
};

export type ReadRecordsArgs = {
  /** Serialized generated fragment document. */
  document: string;
  /** Root fragment to apply to matching normalized records. */
  fragmentName: string;
  cursor?: RecordCursor;
  limit: number;
};

export const MAX_RECORD_SELECTION_PAGE_SIZE = 500;

/** Validates a record-selection page size before crossing a host boundary. */
export function validateRecordSelectionLimit(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_RECORD_SELECTION_PAGE_SIZE
  ) {
    throw new RangeError(
      `record selection limit must be an integer between 1 and ${MAX_RECORD_SELECTION_PAGE_SIZE}`
    );
  }
  return limit;
}

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
    | { kind: 'prependUnique'; entityKey: string }
    | {
        kind: 'removeEmbeddedLink';
        listItem: {
          whereField: string;
          equals: string | number | boolean | null;
        };
        linkField: string;
        countField: string;
        entityKey: string;
      }
    | {
        kind: 'upsertEmbeddedLink';
        listItem: {
          whereField: string;
          equals: string | number | boolean | null;
        };
        linkField: string;
        countField: string;
        entityKey: string;
        /** Scalar fields used only when the embedded item must be created. */
        insertFields: Record<string, string | number | boolean | null>;
      };
};

export type CachedQueryVariantWire = {
  variables: Record<string, unknown>;
};

export type CachedQueryInstanceWire = CachedQueryVariantWire & {
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

/** Outcome of the strict-head claim attempted immediately after enqueue. */
export type InitialMutationClaim =
  | { kind: 'claimed'; mutation: ClaimedMutation }
  | { kind: 'not-runnable' }
  | { kind: 'failed'; error: string };

/** Result returned after enqueue and the initial claim attempt complete. */
export type EnqueueOptimisticMutationResult = OptimisticWriteResult & {
  initialClaim: InitialMutationClaim;
};

/** Identifies the queue attempt allowed to settle a transaction. */
export type MutationClaim = {
  owner: string;
  generation: string;
};

/** Final settlement of a previously queued optimistic mutation. */
export type MutationSettlement =
  | { transactionId: string; status: 'committed' }
  | {
      transactionId: string;
      status: 'permanently-failed';
      error: string;
    };

export type CacheRequest = { id: number } & (
  | { kind: 'init'; scope: string; hotCapacity?: number }
  | {
      kind: 'read';
      opId?: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      /** May overtake unrelated observational reads, never ordering barriers. */
      priority?: CacheReadPriority;
      /** Per-read synthetic entity relations. */
      entityResolvers?: readonly EntityResolverWire[];
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
  /** Durably enqueue an optimistic mutation and claim the strict head. */
  | {
      kind: 'enqueue-optimistic-mutation';
      originOpId?: string;
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      data: unknown;
      linkPatches?: OptimisticLinkPatchWire[];
      revalidations?: QueryRevalidationWire[];
      createdAtMs: number;
      owner: string;
      nowMs: number;
      leaseExpiresAtMs: number;
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
      error: string;
    }
  | {
      kind: 'read-records';
      document: string;
      fragmentName: string;
      cursor?: RecordCursor;
      limit: number;
    }
  | {
      kind: 'inspect-query';
      query: string;
      operationName?: string;
      /** Response-key field path from the query root. */
      path: Array<{ field: string }>;
      /** OR-ed recursive partial matches applied before result materialization. */
      variableFilters?: QueryVariableFilter[];
    }
  | {
      kind: 'inspect-query-variants';
      query: string;
      operationName?: string;
      /** Response-key field path from the query root. */
      path: Array<{ field: string }>;
    }
  | { kind: 'teardown'; opId: string }
  /** External invalidation (e.g. websocket push): evict + report ops. */
  | { kind: 'invalidate'; keys: string[] }
  /** Apply explicit server-provided cache-deletion effects. */
  | { kind: 'delete-records'; keys: string[] }
  | { kind: 'clear' }
);

/** Stable machine-readable cache RPC rejection codes. */
export type CacheResponseErrorCode =
  | 'owner-epoch-lost'
  | 'admitted-enqueue-uncertain';

/** Old-owner work was rejected after fenced engine loss and was not replayed. */
export const OWNER_EPOCH_LOST_ERROR_CODE: CacheResponseErrorCode =
  'owner-epoch-lost';

/** An enqueue send was admitted before its unfenced transport became uncertain. */
export const ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE: CacheResponseErrorCode =
  'admitted-enqueue-uncertain';

export type CacheResponse =
  | { id: number; ok: true; result: unknown }
  | {
      id: number;
      ok: false;
      error: string;
      errorCode?: CacheResponseErrorCode;
    };

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
  | { kind: 'cache-changed' }
  | { kind: 'mutation-settled'; settlement: MutationSettlement };

export type WorkerMessage = CacheResponse | CachePush;

type UnknownWireRecord = Record<string, unknown>;

const isWireRecord = (value: unknown): value is UnknownWireRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyWireKeys = (
  value: UnknownWireRecord,
  keys: readonly string[]
): boolean => Object.keys(value).every((key) => keys.includes(key));

const isWireStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Strictly validates a machine-readable cache response error code. */
export const isCacheResponseErrorCode = (
  value: unknown
): value is CacheResponseErrorCode =>
  value === OWNER_EPOCH_LOST_ERROR_CODE ||
  value === ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE;

/** Identifies a coordinator-fenced rejection from a lost owner epoch. */
export const isOwnerEpochLostError = (
  value: unknown
): value is Error & { errorCode: 'owner-epoch-lost' } =>
  value instanceof Error &&
  'errorCode' in value &&
  value.errorCode === OWNER_EPOCH_LOST_ERROR_CODE;

/** Identifies the host-only uncertainty result for an admitted enqueue send. */
export const isAdmittedEnqueueUncertainError = (
  value: unknown
): value is Error & { errorCode: 'admitted-enqueue-uncertain' } =>
  value instanceof Error &&
  'errorCode' in value &&
  value.errorCode === ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE;

/** Strictly validates a cache response received across a host boundary. */
export function isCacheResponse(value: unknown): value is CacheResponse {
  if (
    !isWireRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    (value.id as number) < 0
  ) {
    return false;
  }
  if (value.ok === true) {
    return (
      hasOnlyWireKeys(value, ['id', 'ok', 'result']) &&
      Object.hasOwn(value, 'result')
    );
  }
  return (
    value.ok === false &&
    hasOnlyWireKeys(value, ['id', 'ok', 'error', 'errorCode']) &&
    typeof value.error === 'string' &&
    (value.errorCode === undefined || isCacheResponseErrorCode(value.errorCode))
  );
}

/** Strictly validates a pushed cache notification. */
export function isCachePush(value: unknown): value is CachePush {
  if (!isWireRecord(value)) return false;
  switch (value.kind) {
    case 'ops-affected':
      return (
        hasOnlyWireKeys(value, ['kind', 'opIds', 'keys']) &&
        isWireStringArray(value.opIds) &&
        isWireStringArray(value.keys)
      );
    case 'cache-changed':
      return hasOnlyWireKeys(value, ['kind']);
    case 'mutation-settled': {
      const settlement = value.settlement;
      if (
        !hasOnlyWireKeys(value, ['kind', 'settlement']) ||
        !isWireRecord(settlement) ||
        typeof settlement.transactionId !== 'string'
      ) {
        return false;
      }
      if (settlement.status === 'committed') {
        return hasOnlyWireKeys(settlement, ['transactionId', 'status']);
      }
      return (
        settlement.status === 'permanently-failed' &&
        hasOnlyWireKeys(settlement, ['transactionId', 'status', 'error']) &&
        typeof settlement.error === 'string'
      );
    }
    default:
      return false;
  }
}

/** Strictly validates any response or push delivered to a cache host. */
export const isWorkerMessage = (value: unknown): value is WorkerMessage =>
  isCacheResponse(value) || isCachePush(value);
