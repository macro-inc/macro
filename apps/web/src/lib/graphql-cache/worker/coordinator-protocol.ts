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
  MAX_RECORD_SELECTION_PAGE_SIZE,
  type WorkerMessage,
} from '../protocol';

export { isCachePush, isCacheResponse, isWorkerMessage };

/** Version of the topology envelope and routed cache RPC surface. */
export const CACHE_COORDINATOR_PROTOCOL_VERSION = 2 as const;

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
export type ActivationFailureCode =
  | 'initialization-failed'
  | 'recovery-open-failed';

export type TabToCoordinatorEnvelope =
  | {
      coordinatorVersion: 2;
      kind: 'register-tab';
      scope: string;
      tabId: string;
      livenessLockName: string;
      hotCapacity?: number;
    }
  | {
      coordinatorVersion: 2;
      kind: 'cache-request';
      tabId: string;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: 2;
      kind: 'attach-engine-port';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      enginePort: MessagePort;
    }
  | {
      coordinatorVersion: 2;
      kind: 'graceful-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 2;
      kind: 'navigation-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-lost';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 2;
      kind: 'disconnect-tab';
      tabId: string;
      reason: string;
    };

export type CoordinatorToTabEnvelope =
  | {
      coordinatorVersion: 2;
      kind: 'registered';
      tabId: string;
    }
  | {
      coordinatorVersion: 2;
      kind: 'become-owner';
      scope: string;
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
      ownerLockName: string;
      hotCapacity?: number;
    }
  | {
      coordinatorVersion: 2;
      kind: 'cache-message';
      message: WorkerMessage;
    }
  | {
      coordinatorVersion: 2;
      kind: 'terminate-engine';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: 2;
      kind: 'retire-complete';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-replaced';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 2;
      kind: 'protocol-error';
      error: string;
    };

export type PageToEngineEnvelope = {
  coordinatorVersion: 2;
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
      coordinatorVersion: 2;
      kind: 'engine-request';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: 2;
      kind: 'drain-engine';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 2;
      kind: 'heartbeat';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
    };

export type EngineToCoordinatorEnvelope =
  | {
      coordinatorVersion: 2;
      kind: 'engine-ready';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      ownerLockName: string;
      ownerLockHeld: true;
      databaseActionProof: DatabaseActionProof;
      openOutcome: EngineOpenOutcome;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-response';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      response: CacheResponse;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-push';
      ownerEpoch: OwnerEpoch;
      push: CachePush;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-drained';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: 2;
      kind: 'engine-fatal';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      fatalCode: EngineFatalCode;
    }
  | {
      coordinatorVersion: 2;
      kind: 'activation-failed';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      failureCode: ActivationFailureCode;
    }
  | {
      coordinatorVersion: 2;
      kind: 'heartbeat-ack';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
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
  value === 'initialization-failed' || value === 'recovery-open-failed';

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
        ]) &&
        isRecord(request.filters) &&
        ['CREATED_AT', 'UPDATED_AT', 'VIEWED_AT', 'VIEWED_UPDATED'].includes(
          request.sortMethod as string
        ) &&
        (request.sortDirection === 'ASC' || request.sortDirection === 'DESC') &&
        isValidCacheSearchLimit(request.limit)
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
    case 'engine-replaced':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'ownerEpoch']) &&
        isPositiveInteger(value.ownerEpoch)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
    case 'protocol-error':
      if (
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'error']) &&
        isNonEmptyString(value.error)
      ) {
        return pass(value as CoordinatorToTabEnvelope);
      }
      break;
  }
  return fail(`invalid ${value.kind} coordinator envelope`);
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

export const tabLivenessLockName = (scope: string, tabId: string): string =>
  `graphql-cache-tab:${scope}:${tabId}`;

/** Mirrors turso-opfs's canonical lock derivation without exposing a new lock. */
export function databaseOwnerLockName(scope: string): string {
  const databaseIdentity = `graphql-cache:${scope}`;
  const byteLength = new TextEncoder().encode(databaseIdentity).byteLength;
  return `macro:turso-opfs:v1:${byteLength}:${databaseIdentity}`;
}
