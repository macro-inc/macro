import {
  type CachePush,
  type CacheRequest,
  type CacheResponse,
  isCachePush,
  isCacheResponse,
  isValidCacheSearchBucket,
  isValidCacheSearchCursor,
  isValidCacheSearchLimit,
  isValidCacheSearchNowMs,
  isValidCacheSearchProfile,
  isValidCacheSearchQuery,
  isValidNormalizedRecordKey,
  isWorkerMessage,
  MAX_RECONCILIATION_BASELINE,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  type WorkerMessage,
} from '../protocol';

export { isCachePush, isCacheResponse, isWorkerMessage };

/** Version of the topology envelope and routed cache RPC surface. */
export const CACHE_COORDINATOR_PROTOCOL_VERSION = 6 as const;
/**
 * Startup phases in order. The engine may touch storage only in
 * `opening-database`, which begins once it holds the database owner lock. It
 * never queues for that lock: while another context holds it, the engine
 * retries briefly and then gives up without touching storage.
 */
export type EngineStartupPhase =
  | 'loading-assets'
  | 'awaiting-owner-lock'
  | 'opening-database';

export const ENGINE_STARTUP_PHASES: readonly EngineStartupPhase[] = [
  'loading-assets',
  'awaiting-owner-lock',
  'opening-database',
];

export type OwnerEpoch = number;
export type RouteId = number;
export type DatabaseAction = 'open-existing' | 'wipe-before-open';
export type DatabaseActionProof = 'opened-existing' | 'wiped-before-open';
export type EngineOpenOutcome =
  | 'opened-existing'
  | 'opened-new'
  | 'reset-incompatible'
  | 'reset-corrupt'
  | 'reset-storage-uncertain';
export type EngineFatalCode = 'storage-reset-required' | 'runtime-failure';
/** `storage-busy`: another context kept the database files open through the
 * engine's bounded wait. An open changed nothing; a wipe may have removed one
 * file, so the coordinator keeps the attempt's database action. */
export type ActivationFailureCode =
  | 'initialization-failed'
  | 'recovery-open-failed'
  | 'storage-busy';

export type TabToCoordinatorEnvelope =
  | {
      coordinatorVersion: 6;
      kind: 'register-tab';
      scope: string;
      tabId: string;
      livenessLockName: string;
      hotCapacity?: number;
    }
  | {
      coordinatorVersion: 6;
      kind: 'cache-request';
      tabId: string;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: 6;
      kind: 'attach-engine-port';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      enginePort: MessagePort;
    }
  | {
      coordinatorVersion: 6;
      kind: 'graceful-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'navigation-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-lost';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 6;
      kind: 'disconnect-tab';
      tabId: string;
      reason: string;
    };

export type CoordinatorToTabEnvelope =
  | {
      coordinatorVersion: 6;
      kind: 'registered';
      tabId: string;
    }
  | {
      coordinatorVersion: 6;
      kind: 'become-owner';
      scope: string;
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
      ownerLockName: string;
      hotCapacity?: number;
    }
  | {
      coordinatorVersion: 6;
      kind: 'cache-message';
      message: WorkerMessage;
    }
  | {
      coordinatorVersion: 6;
      kind: 'terminate-engine';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 6;
      kind: 'retire-complete';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-startup';
      ownerEpoch: OwnerEpoch;
      phase: EngineStartupPhase;
      databaseAction: DatabaseAction;
      timeoutMs: number;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-replaced';
      ownerEpoch: OwnerEpoch;
      /** Whether this engine reopened durable data or created/reset it. */
      openOutcome: EngineOpenOutcome;
    }
  | {
      coordinatorVersion: 6;
      kind: 'protocol-error';
      error: string;
    }
  | {
      coordinatorVersion: 6;
      kind: 'terminal-error';
      error: string;
      storageUntouched?: true;
    }
  | {
      /** Another context holds the database; stop using the cache until reload. */
      coordinatorVersion: 6;
      kind: 'cache-unavailable';
      reason: string;
    }
  | {
      /** No other build has live tabs, so the owner may delete stale databases. */
      coordinatorVersion: 6;
      kind: 'remove-stale-databases';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    };

export type PageToEngineEnvelope = {
  coordinatorVersion: 6;
  kind: 'activate-engine';
  scope: string;
  tabId: string;
  ownerEpoch: OwnerEpoch;
  databaseAction: DatabaseAction;
  ownerLockName: string;
  hotCapacity?: number;
};

export type CoordinatorToEngineEnvelope =
  | {
      /** Storage grant, sent only after `owner-lock-acquired`. */
      coordinatorVersion: 6;
      kind: 'open-engine';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-request';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: 6;
      kind: 'drain-engine';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'heartbeat';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
    };

export type EngineToCoordinatorEnvelope =
  | {
      coordinatorVersion: 6;
      kind: 'engine-assets-ready';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      /** Holds the owner lock, has not touched storage, awaits `open-engine`. */
      coordinatorVersion: 6;
      kind: 'owner-lock-acquired';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      /** The owner lock was held elsewhere on this attempt; retrying. */
      coordinatorVersion: 6;
      kind: 'owner-lock-busy';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      attempt: number;
      elapsedMs: number;
    }
  | {
      /** Gave up on the owner lock without touching storage. */
      coordinatorVersion: 6;
      kind: 'owner-lock-unavailable';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-ready';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      ownerLockName: string;
      ownerLockHeld: true;
      databaseActionProof: DatabaseActionProof;
      openOutcome: EngineOpenOutcome;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-response';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      response: CacheResponse;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-push';
      ownerEpoch: OwnerEpoch;
      push: CachePush;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-drained';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 6;
      kind: 'engine-fatal';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      fatalCode: EngineFatalCode;
    }
  | {
      coordinatorVersion: 6;
      kind: 'activation-failed';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      failureCode: ActivationFailureCode;
    }
  | {
      coordinatorVersion: 6;
      kind: 'heartbeat-ack';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
    };

/** Starts a disposable worker that deletes this scope's stale databases. */
export type PageToCleanupEnvelope = {
  coordinatorVersion: 6;
  kind: 'remove-stale-databases';
  scope: string;
};

/** Tally from a stale-database cleanup worker. */
export type CleanupToPageEnvelope = {
  coordinatorVersion: 6;
  kind: 'stale-databases-removed';
  removed: number;
  inUse: number;
  keptWithQueuedMutations: number;
  /** Cleanup stopped at an error; remaining databases wait for a later run. */
  failed: boolean;
};

export type EnvelopeValidation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

const fail = <T>(error: string): EnvelopeValidation<T> => ({
  ok: false,
  error,
});

const pass = <T>(value: T): EnvelopeValidation<T> => ({ ok: true, value });

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.length > 0;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || isString(value);

const isSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value);

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && (value as number) >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isOptionalPositiveInteger = (
  value: unknown
): value is number | undefined =>
  value === undefined || isPositiveInteger(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.hasOwn(record, key);

const hasOnlyKeys = (record: UnknownRecord, keys: readonly string[]): boolean =>
  Object.keys(record).every((key) => keys.includes(key));

const hasVersion = (record: UnknownRecord): boolean =>
  record.coordinatorVersion === CACHE_COORDINATOR_PROTOCOL_VERSION;

const isDatabaseAction = (value: unknown): value is DatabaseAction =>
  value === 'open-existing' || value === 'wipe-before-open';

const isEngineStartupPhase = (value: unknown): value is EngineStartupPhase =>
  ENGINE_STARTUP_PHASES.includes(value as EngineStartupPhase);

const isDatabaseActionProof = (value: unknown): value is DatabaseActionProof =>
  value === 'opened-existing' || value === 'wiped-before-open';

const isEngineOpenOutcome = (value: unknown): value is EngineOpenOutcome =>
  typeof value === 'string' &&
  [
    'opened-existing',
    'opened-new',
    'reset-incompatible',
    'reset-corrupt',
    'reset-storage-uncertain',
  ].includes(value);

const isEngineFatalCode = (value: unknown): value is EngineFatalCode =>
  value === 'storage-reset-required' || value === 'runtime-failure';

const isActivationFailureCode = (
  value: unknown
): value is ActivationFailureCode =>
  value === 'initialization-failed' ||
  value === 'recovery-open-failed' ||
  value === 'storage-busy';

const isOptionalRecord = (
  value: unknown
): value is Record<string, unknown> | undefined =>
  value === undefined || isRecord(value);

const isMessagePort = (value: unknown): value is MessagePort =>
  typeof value === 'object' &&
  value !== null &&
  'postMessage' in value &&
  typeof value.postMessage === 'function' &&
  'close' in value &&
  typeof value.close === 'function' &&
  'start' in value &&
  typeof value.start === 'function';

const isPath = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (segment) =>
      isRecord(segment) &&
      hasOnlyKeys(segment, ['field']) &&
      isString(segment.field)
  );

const isEntityResolvers = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (resolver) =>
        isRecord(resolver) &&
        isString(resolver.parentType) &&
        isString(resolver.fieldName) &&
        isString(resolver.targetType) &&
        isStringArray(resolver.argumentPath)
    ));

const isWriteRegistration = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) &&
    hasOnlyKeys(value, ['opId', 'entityResolvers']) &&
    isNonEmptyString(value.opId) &&
    isEntityResolvers(value.entityResolvers));

const isSearchRequest = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      'profile',
      'buckets',
      'query',
      'cursor',
      'limit',
      'nowMs',
    ]) &&
    isValidCacheSearchProfile(value.profile) &&
    Array.isArray(value.buckets) &&
    value.buckets.every(isValidCacheSearchBucket) &&
    isValidCacheSearchQuery(value.query) &&
    isValidCacheSearchLimit(value.limit) &&
    isValidCacheSearchNowMs(value.nowMs) &&
    (value.cursor === undefined || isValidCacheSearchCursor(value.cursor))
  );
};

const commonRequest = (record: UnknownRecord): boolean =>
  isSafeNonNegativeInteger(record.id) && isNonEmptyString(record.kind);

/** Strictly validates a cache RPC request nested in a coordinator envelope. */
export function isCacheRequest(value: unknown): value is CacheRequest {
  if (!isRecord(value) || !commonRequest(value)) return false;
  switch (value.kind) {
    case 'init':
      return (
        hasOnlyKeys(value, ['id', 'kind', 'scope', 'hotCapacity']) &&
        isNonEmptyString(value.scope) &&
        isOptionalPositiveInteger(value.hotCapacity)
      );
    case 'current-revision':
    case 'current-storage-generation':
      return hasOnlyKeys(value, ['id', 'kind']);
    case 'read':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'opId',
          'query',
          'operationName',
          'variables',
          'priority',
          'entityResolvers',
        ]) &&
        isOptionalString(value.opId) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        (value.priority === undefined || value.priority === 'user-visible') &&
        isEntityResolvers(value.entityResolvers)
      );
    case 'write':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'originOpId',
          'registration',
          'query',
          'operationName',
          'variables',
          'data',
          'identity',
        ]) &&
        isOptionalString(value.originOpId) &&
        isWriteRegistration(value.registration) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        hasOwn(value, 'data') &&
        isOptionalString(value.identity)
      );
    case 'hydrate':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'query',
          'operationName',
          'variables',
          'data',
          'identity',
        ]) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        hasOwn(value, 'data') &&
        isOptionalString(value.identity)
      );
    case 'enqueue-optimistic-mutation':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'originOpId',
          'uuid',
          'query',
          'operationName',
          'variables',
          'data',
          'linkPatches',
          'revalidations',
          'createdAtMs',
          'owner',
          'nowMs',
          'leaseExpiresAtMs',
        ]) &&
        isOptionalString(value.originOpId) &&
        isString(value.uuid) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        hasOwn(value, 'data') &&
        (value.linkPatches === undefined || Array.isArray(value.linkPatches)) &&
        (value.revalidations === undefined ||
          Array.isArray(value.revalidations)) &&
        isSafeNonNegativeInteger(value.createdAtMs) &&
        isString(value.owner) &&
        isSafeNonNegativeInteger(value.nowMs) &&
        isSafeNonNegativeInteger(value.leaseExpiresAtMs)
      );
    case 'claim-next-mutation':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'owner',
          'nowMs',
          'leaseExpiresAtMs',
        ]) &&
        isString(value.owner) &&
        isSafeNonNegativeInteger(value.nowMs) &&
        isSafeNonNegativeInteger(value.leaseExpiresAtMs)
      );
    case 'defer-optimistic-write':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'transactionId',
          'leaseOwner',
          'leaseGeneration',
          'nextAttemptAtMs',
          'error',
        ]) &&
        isString(value.transactionId) &&
        isString(value.leaseOwner) &&
        isString(value.leaseGeneration) &&
        isSafeNonNegativeInteger(value.nextAttemptAtMs) &&
        isString(value.error)
      );
    case 'commit-optimistic-write':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'transactionId',
          'leaseOwner',
          'leaseGeneration',
          'query',
          'operationName',
          'variables',
          'data',
        ]) &&
        isString(value.transactionId) &&
        isString(value.leaseOwner) &&
        isString(value.leaseGeneration) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        hasOwn(value, 'data')
      );
    case 'rollback-optimistic-write':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'transactionId',
          'leaseOwner',
          'leaseGeneration',
          'error',
        ]) &&
        isString(value.transactionId) &&
        isString(value.leaseOwner) &&
        isString(value.leaseGeneration) &&
        isString(value.error)
      );
    case 'read-records-by-keys':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'document',
          'fragmentName',
          'keys',
        ]) &&
        isString(value.document) &&
        isString(value.fragmentName) &&
        Array.isArray(value.keys) &&
        value.keys.length <= MAX_RECORD_SELECTION_PAGE_SIZE &&
        value.keys.every(isValidNormalizedRecordKey)
      );
    case 'search':
      return (
        hasOnlyKeys(value, ['id', 'kind', 'request']) &&
        isSearchRequest(value.request)
      );
    case 'entity-filter': {
      const request = value.request;
      return (
        hasOnlyKeys(value, ['id', 'kind', 'request']) &&
        isRecord(request) &&
        hasOnlyKeys(request, [
          'filters',
          'sortMethod',
          'sortDirection',
          'limit',
          'baseline',
          'mail',
        ]) &&
        isRecord(request.filters) &&
        ['CREATED_AT', 'UPDATED_AT', 'VIEWED_AT', 'VIEWED_UPDATED'].includes(
          request.sortMethod as string
        ) &&
        (request.sortDirection === 'ASC' || request.sortDirection === 'DESC') &&
        isValidCacheSearchLimit(request.limit) &&
        (request.mail === undefined ||
          (isRecord(request.mail) &&
            hasOnlyKeys(request.mail, ['view', 'cursor']) &&
            ['ALL', 'INBOX', 'DRAFTS', 'SENT'].includes(
              request.mail.view as string
            ) &&
            request.limit < 500 &&
            request.baseline === undefined &&
            (request.mail.cursor === undefined ||
              (typeof request.mail.cursor === 'string' &&
                request.mail.cursor.length <= 4096)))) &&
        (request.baseline === undefined ||
          (Array.isArray(request.baseline) &&
            request.baseline.length <= MAX_RECONCILIATION_BASELINE &&
            request.baseline.every(
              (entry) =>
                isRecord(entry) &&
                hasOnlyKeys(entry, ['key', 'sortTimestamp']) &&
                isValidNormalizedRecordKey(entry.key) &&
                typeof entry.sortTimestamp === 'string' &&
                entry.sortTimestamp.length <= 64
            )))
      );
    }
    case 'inspect-query':
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'query',
          'operationName',
          'path',
          'variableFilters',
        ]) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isPath(value.path) &&
        (value.variableFilters === undefined ||
          (Array.isArray(value.variableFilters) &&
            value.variableFilters.every(isRecord)))
      );
    case 'inspect-query-variants':
      return (
        hasOnlyKeys(value, ['id', 'kind', 'query', 'operationName', 'path']) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isPath(value.path)
      );
    case 'teardown':
      return hasOnlyKeys(value, ['id', 'kind', 'opId']) && isString(value.opId);
    case 'invalidate':
    case 'delete-records':
      return (
        hasOnlyKeys(value, ['id', 'kind', 'keys']) && isStringArray(value.keys)
      );
    case 'clear':
      return hasOnlyKeys(value, ['id', 'kind']);
    default:
      return false;
  }
}

/** Validates an untrusted page-to-coordinator message. */
export function validateTabToCoordinatorEnvelope(
  value: unknown
): EnvelopeValidation<TabToCoordinatorEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  const base =
    value.coordinatorVersion === CACHE_COORDINATOR_PROTOCOL_VERSION &&
    isNonEmptyString(value.tabId);
  if (!base) return fail('invalid coordinator tab identity');

  switch (value.kind) {
    case 'register-tab':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'scope',
          'tabId',
          'livenessLockName',
          'hotCapacity',
        ]) &&
        isNonEmptyString(value.scope) &&
        isNonEmptyString(value.livenessLockName) &&
        isOptionalPositiveInteger(value.hotCapacity)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'cache-request':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'request',
        ]) &&
        isCacheRequest(value.request)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'attach-engine-port':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'enginePort',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isMessagePort(value.enginePort)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'graceful-departure':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
        ]) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'navigation-departure':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'reason',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.reason)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'engine-lost':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'reason',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.reason)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
    case 'disconnect-tab':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'tabId', 'reason']) &&
        isNonEmptyString(value.reason)
      ) {
        return pass(value as TabToCoordinatorEnvelope);
      }
      break;
  }
  return fail(`invalid ${value.kind} coordinator envelope`);
}

/** Validates an untrusted coordinator-to-page message. */
export function validateCoordinatorToTabEnvelope(
  value: unknown
): EnvelopeValidation<CoordinatorToTabEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  switch (value.kind) {
    case 'registered':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'tabId']) &&
        isNonEmptyString(value.tabId)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'become-owner':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'scope',
          'tabId',
          'ownerEpoch',
          'databaseAction',
          'ownerLockName',
          'hotCapacity',
        ]) &&
        isNonEmptyString(value.scope) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isDatabaseAction(value.databaseAction) &&
        isNonEmptyString(value.ownerLockName) &&
        isOptionalPositiveInteger(value.hotCapacity)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'cache-message':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'message']) &&
        isWorkerMessage(value.message)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'terminate-engine':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'reason',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.reason)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'retire-complete':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'engine-startup':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'phase',
          'databaseAction',
          'timeoutMs',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isEngineStartupPhase(value.phase) &&
        isDatabaseAction(value.databaseAction) &&
        isPositiveInteger(value.timeoutMs)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'engine-replaced':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'openOutcome',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isEngineOpenOutcome(value.openOutcome)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'terminal-error':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'error',
          'storageUntouched',
        ]) &&
        isNonEmptyString(value.error) &&
        (value.storageUntouched === undefined ||
          value.storageUntouched === true)
      )
        return pass(value as CoordinatorToTabEnvelope);
      break;
    case 'protocol-error':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'error']) &&
        isNonEmptyString(value.error)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'cache-unavailable':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'reason']) &&
        isNonEmptyString(value.reason)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'remove-stale-databases':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
  }
  return fail(`invalid ${value.kind} coordinator envelope`);
}

/** Validates the page's message starting a stale-database cleanup worker. */
export function validatePageToCleanupEnvelope(
  value: unknown
): EnvelopeValidation<PageToCleanupEnvelope> {
  if (
    isRecord(value) &&
    hasVersion(value) &&
    value.kind === 'remove-stale-databases' &&
    hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'scope']) &&
    isNonEmptyString(value.scope)
  ) {
    return pass(value as PageToCleanupEnvelope);
  }
  return fail('invalid remove-stale-databases envelope');
}

/** Validates a cleanup worker's tally. */
export function validateCleanupToPageEnvelope(
  value: unknown
): EnvelopeValidation<CleanupToPageEnvelope> {
  if (
    isRecord(value) &&
    hasVersion(value) &&
    value.kind === 'stale-databases-removed' &&
    hasOnlyKeys(value, [
      'coordinatorVersion',
      'kind',
      'removed',
      'inUse',
      'keptWithQueuedMutations',
      'failed',
    ]) &&
    isSafeNonNegativeInteger(value.removed) &&
    isSafeNonNegativeInteger(value.inUse) &&
    isSafeNonNegativeInteger(value.keptWithQueuedMutations) &&
    typeof value.failed === 'boolean'
  ) {
    return pass(value as CleanupToPageEnvelope);
  }
  return fail('invalid stale-databases-removed envelope');
}

/** Validates the page's one-time DedicatedWorker activation message. */
export function validatePageToEngineEnvelope(
  value: unknown
): EnvelopeValidation<PageToEngineEnvelope> {
  if (
    isRecord(value) &&
    hasVersion(value) &&
    value.kind === 'activate-engine' &&
    hasOnlyKeys(value, [
      'coordinatorVersion',
      'kind',
      'scope',
      'tabId',
      'ownerEpoch',
      'databaseAction',
      'ownerLockName',
      'hotCapacity',
    ]) &&
    isNonEmptyString(value.scope) &&
    isNonEmptyString(value.tabId) &&
    isPositiveInteger(value.ownerEpoch) &&
    isDatabaseAction(value.databaseAction) &&
    isNonEmptyString(value.ownerLockName) &&
    isOptionalPositiveInteger(value.hotCapacity)
  ) {
    return pass(value as PageToEngineEnvelope);
  }
  return fail('invalid activate-engine envelope');
}

/** Validates an untrusted coordinator-to-engine direct-port message. */
export function validateCoordinatorToEngineEnvelope(
  value: unknown
): EnvelopeValidation<CoordinatorToEngineEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  switch (value.kind) {
    case 'engine-request':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'routeId',
          'request',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.routeId) &&
        isCacheRequest(value.request) &&
        value.request.id === value.routeId
      ) {
        return pass(value as CoordinatorToEngineEnvelope);
      }
      break;
    case 'open-engine':
    case 'drain-engine':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'ownerEpoch']) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as CoordinatorToEngineEnvelope);
      }
      break;
    case 'heartbeat':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'heartbeatId',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.heartbeatId)
      ) {
        return pass(value as CoordinatorToEngineEnvelope);
      }
      break;
  }
  return fail(`invalid ${value.kind} coordinator envelope`);
}

/** Validates an untrusted engine-to-coordinator direct-port message. */
export function validateEngineToCoordinatorEnvelope(
  value: unknown
): EnvelopeValidation<EngineToCoordinatorEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  switch (value.kind) {
    case 'engine-ready':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'ownerLockName',
          'ownerLockHeld',
          'databaseActionProof',
          'openOutcome',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.ownerLockName) &&
        value.ownerLockHeld === true &&
        isDatabaseActionProof(value.databaseActionProof) &&
        isEngineOpenOutcome(value.openOutcome)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'engine-response':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'routeId',
          'response',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.routeId) &&
        isCacheResponse(value.response) &&
        (value.response.ok || value.response.errorCode === undefined) &&
        value.response.id === value.routeId
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'engine-push':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'push',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isCachePush(value.push)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'engine-assets-ready':
    case 'owner-lock-acquired':
    case 'owner-lock-unavailable':
    case 'engine-drained':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'owner-lock-busy':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'attempt',
          'elapsedMs',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.attempt) &&
        isSafeNonNegativeInteger(value.elapsedMs)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'engine-fatal':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'reason',
          'fatalCode',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.reason) &&
        isEngineFatalCode(value.fatalCode)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'activation-failed':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
          'reason',
          'failureCode',
        ]) &&
        isNonEmptyString(value.tabId) &&
        isPositiveInteger(value.ownerEpoch) &&
        isNonEmptyString(value.reason) &&
        isActivationFailureCode(value.failureCode)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
    case 'heartbeat-ack':
      if (
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'heartbeatId',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.heartbeatId)
      ) {
        return pass(value as EngineToCoordinatorEnvelope);
      }
      break;
  }
  return fail(`invalid ${value.kind} coordinator envelope`);
}

const TAB_LIVENESS_LOCK_PREFIX = 'graphql-cache-tab:';

export const tabLivenessLockName = (scope: string, tabId: string): string =>
  `${TAB_LIVENESS_LOCK_PREFIX}${scope}:${tabId}`;

/** The tab id in a liveness lock name for `scope`, if it is one. */
export function tabIdFromLivenessLockName(
  scope: string,
  lockName: string
): string | undefined {
  const prefix = `${TAB_LIVENESS_LOCK_PREFIX}${scope}:`;
  if (!lockName.startsWith(prefix)) return;
  const tabId = lockName.slice(prefix.length);
  return tabId.length > 0 ? tabId : undefined;
}

/**
 * Storage versions embedded in the physical database name. Mirrors
 * `CACHE_SCHEMA_COMPATIBILITY_EPOCH`, `CACHE_FORMAT_VERSION` and
 * `STORAGE_SCHEMA_VERSION` in the Rust crates: a parity test compares them,
 * and the engine checks its WASM before touching storage.
 */
export const CACHE_STORAGE_VERSION = {
  schemaCompatibilityEpoch: 3,
  formatVersion: 3,
  storageSchemaVersion: 11,
} as const;

const LEGACY_DATABASE_PREFIX = 'graphql-cache:';

/** Mirrors `cache_database_name`: the physical database this build opens. */
export function cacheDatabaseIdentity(scope: string): string {
  const { schemaCompatibilityEpoch, formatVersion, storageSchemaVersion } =
    CACHE_STORAGE_VERSION;
  return `${LEGACY_DATABASE_PREFIX}${scope}:s${schemaCompatibilityEpoch}.v${formatVersion}.t${storageSchemaVersion}`;
}

/**
 * Whether `identity` is one of this scope's databases that this build does
 * not open: the name all versions shared before names embedded versions, or
 * another storage version's name. Mirrors the WASM's own check.
 */
export function isStaleCacheDatabaseIdentity(
  scope: string,
  identity: string
): boolean {
  const legacy = `${LEGACY_DATABASE_PREFIX}${scope}`;
  if (identity === cacheDatabaseIdentity(scope)) return false;
  if (identity === legacy) return true;
  return (
    identity.startsWith(legacy) &&
    /^:s\d+\.v\d+\.t\d+$/.test(identity.slice(legacy.length))
  );
}

/** Mirrors turso-opfs's canonical lock derivation without exposing a new lock. */
export function databaseOwnerLockName(scope: string): string {
  const databaseIdentity = cacheDatabaseIdentity(scope);
  const byteLength = new TextEncoder().encode(databaseIdentity).byteLength;
  return `macro:turso-opfs:v1:${byteLength}:${databaseIdentity}`;
}
