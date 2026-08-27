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

/** Opaque in-memory revision of one live cache engine generation. */
export type CacheRevision = string & {
  readonly __cacheRevision: unique symbol;
};

const MAX_CACHE_REVISION = 18_446_744_073_709_551_615n;

/** Validates the canonical unsigned-decimal Rust `u64` wire representation. */
export function isCacheRevision(value: unknown): value is CacheRevision {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    BigInt(value) <= MAX_CACHE_REVISION
  );
}

/** Parses an untrusted cache revision at protocol ingress. */
export function parseCacheRevision(value: unknown): CacheRevision {
  if (!isCacheRevision(value)) {
    throw new TypeError('invalid cache revision');
  }
  return value;
}

export const INITIAL_CACHE_REVISION = '0' as CacheRevision;

/** Scheduling hint for latency-sensitive cache reads. */
export type CacheReadPriority = 'user-visible';

/** Recursive partial-variable object used to limit query inspection work. */
export type QueryVariableFilter = Record<string, unknown>;

export type SearchProfile = 'quick-access-v1';

export type SearchCursor = {
  timestampMs: number;
  recordKey: string;
};

export type SearchDocumentWire = {
  profile: SearchProfile;
  recordKey: string;
  bucket: string;
  searchText: string;
  timestampMs: number;
  sourceHash: string;
};

export type SearchCacheArgs = {
  profile: SearchProfile;
  buckets?: string[];
  query?: string;
  cursor?: SearchCursor;
  limit: number;
  /** Injected for deterministic freshness scoring. Defaults to Date.now(). */
  nowMs?: number;
};

export type SearchCachePage = {
  documents: SearchDocumentWire[];
  nextCursor: SearchCursor | null;
};

/** Exact initial-page request over the canonical GraphQL Soup filter input. */
export type EntityFilterCacheArgs = {
  filters: Record<string, unknown>;
  sortMethod: 'CREATED_AT' | 'UPDATED_AT' | 'VIEWED_AT' | 'VIEWED_UPDATED';
  sortDirection: 'ASC' | 'DESC';
  limit: number;
};

export type EntityFilterCacheResult =
  | {
      kind: 'complete';
      revision: CacheRevision;
      keys: string[];
      optimistic: boolean;
    }
  | { kind: 'unsupported' }
  | { kind: 'incomplete'; revision: CacheRevision };

export type ReadRecordsByKeysArgs = {
  /** Serialized generated fragment document. */
  document: string;
  /** Root fragment to apply to the requested normalized records. */
  fragmentName: string;
  /** Canonical normalized entity keys; bounded by the selection page size. */
  keys: string[];
};

export type SelectedRecordByKeyWire = {
  recordKey: string;
  record: unknown;
};

export type ReadRecordsByKeysResult = {
  revision: CacheRevision;
  records: SelectedRecordByKeyWire[];
};

export type AffectedOperationsResult = {
  revision: CacheRevision;
  affectedOps: string[];
};

export type CacheRevisionResult = {
  revision: CacheRevision;
};

export const MAX_RECORD_SELECTION_PAGE_SIZE = 500;
export const MAX_CACHE_SEARCH_QUERY_BYTES = 512;
export const MAX_NORMALIZED_RECORD_KEY_LENGTH = 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Non-throwing canonical normalized-record key validation for wire ingress. */
export function isValidNormalizedRecordKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_NORMALIZED_RECORD_KEY_LENGTH &&
    /^[A-Za-z_][A-Za-z0-9_]*:/.test(value)
  );
}

/** Non-throwing cache-search profile validation for wire ingress. */
export function isValidCacheSearchProfile(
  value: unknown
): value is SearchProfile {
  return value === 'quick-access-v1';
}

/** Non-throwing cache-search limit validation for wire ingress. */
export function isValidCacheSearchLimit(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_RECORD_SELECTION_PAGE_SIZE
  );
}

/** Non-throwing cache-search query validation for wire ingress. */
export function isValidCacheSearchQuery(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new TextEncoder().encode(value).length <= MAX_CACHE_SEARCH_QUERY_BYTES
  );
}

/** Non-throwing cache-search bucket validation for wire ingress. */
export function isValidCacheSearchBucket(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_]{1,64}$/.test(value);
}

/** Non-throwing cache-search clock validation for wire ingress. */
export function isValidCacheSearchNowMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Non-throwing cache-search cursor validation for wire ingress. */
export function isValidCacheSearchCursor(
  value: unknown
): value is SearchCursor {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'timestampMs' || key === 'recordKey'
    ) &&
    Object.hasOwn(value, 'timestampMs') &&
    Object.hasOwn(value, 'recordKey') &&
    Number.isSafeInteger(value.timestampMs) &&
    isValidNormalizedRecordKey(value.recordKey)
  );
}

export function validateRecordSelectionKeys(keys: string[]): string[] {
  if (keys.length > MAX_RECORD_SELECTION_PAGE_SIZE) {
    throw new RangeError(
      `record selection accepts at most ${MAX_RECORD_SELECTION_PAGE_SIZE} keys`
    );
  }
  if (keys.some((key) => !isValidNormalizedRecordKey(key))) {
    throw new RangeError('invalid normalized record key');
  }
  return keys;
}

export function validateCacheSearchArgs(
  args: SearchCacheArgs
): SearchCacheArgs & { nowMs: number } {
  if (!isValidCacheSearchProfile(args.profile)) {
    throw new RangeError('invalid cache search profile');
  }
  if (!isValidCacheSearchLimit(args.limit)) {
    throw new RangeError(
      `cache search limit must be an integer between 1 and ${MAX_RECORD_SELECTION_PAGE_SIZE}`
    );
  }
  const query = args.query === undefined ? '' : args.query;
  if (!isValidCacheSearchQuery(query)) {
    throw new RangeError('cache search query is too long');
  }
  const buckets = args.buckets === undefined ? [] : args.buckets;
  if (
    !Array.isArray(buckets) ||
    buckets.some((bucket) => !isValidCacheSearchBucket(bucket))
  ) {
    throw new RangeError('invalid cache search bucket');
  }
  const nowMs = args.nowMs === undefined ? Date.now() : args.nowMs;
  if (!isValidCacheSearchNowMs(nowMs)) {
    throw new RangeError('invalid cache search nowMs');
  }
  if (args.cursor !== undefined && !isValidCacheSearchCursor(args.cursor)) {
    throw new RangeError('invalid cache search cursor');
  }
  return {
    ...args,
    query,
    buckets,
    nowMs,
  };
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

export type HydrationResult =
  | { kind: 'data'; data: unknown; revision: CacheRevision }
  | { kind: 'void'; revision: CacheRevision };

export type WriteResult = {
  /** Effective-view revision installed by this logical mutation. */
  revision: CacheRevision;
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
  | { kind: 'current-revision' }
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
      registration?: {
        opId: string;
        entityResolvers?: readonly EntityResolverWire[];
      };
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
  | {
      kind: 'hydrate';
      query: string;
      operationName?: string;
      variables?: Record<string, unknown>;
      data: unknown;
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
      kind: 'read-records-by-keys';
      document: string;
      fragmentName: string;
      keys: string[];
    }
  | {
      kind: 'search';
      request: SearchCacheArgs & { nowMs: number };
    }
  | {
      kind: 'entity-filter';
      request: EntityFilterCacheArgs;
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
  | { kind: 'cache-changed'; revision: CacheRevision }
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
      return (
        hasOnlyWireKeys(value, ['kind', 'revision']) &&
        isCacheRevision(value.revision)
      );
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
