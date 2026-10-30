import { match as matchBranch } from 'ts-pattern';
import {
  type CachePush,
  type CacheRequest,
  type CacheResponse,
  isCachePush,
  isCacheResponse,
  isCacheRevision,
  isValidCacheSearchBucket,
  isValidCacheSearchCursor,
  isValidCacheSearchLimit,
  isValidCacheSearchNowMs,
  isValidCacheSearchProfile,
  isValidCacheSearchQuery,
  isValidCalendarCommitArgs,
  isValidCalendarRangeArgs,
  isValidNormalizedRecordKey,
  isWorkerMessage,
  MAX_MAIL_THROUGH_ROWS,
  MAX_RECONCILIATION_BASELINE,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  type WorkerMessage,
} from '../protocol';

export { isCachePush, isCacheResponse, isWorkerMessage };

/** Version of the topology envelope and routed cache RPC surface. */
export const CACHE_COORDINATOR_PROTOCOL_VERSION = 10 as const;
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

/** Waiting queues reads without a deadline; blocked permits read-only fallback. */
export type CacheReadState = 'ready' | 'waiting' | 'blocked';

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
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'tab-visibility';
      tabId: string;
      visible: boolean;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'register-tab';
      scope: string;
      tabId: string;
      livenessLockName: string;
      visible: boolean;
      hotCapacity?: number;
      /** When the page's app build was made, in ms since the epoch; 0 if
       * unstamped. A newer build takes the database over from an older one. */
      buildTime: number;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'cache-request';
      tabId: string;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'attach-engine-port';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      enginePort: MessagePort;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'graceful-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'navigation-departure';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-lost';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'disconnect-tab';
      tabId: string;
      reason: string;
    };

export type CoordinatorToTabEnvelope =
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'cache-read-availability';
      /** Zero is valid only for an initially parked scope with no engine yet. */
      ownerEpoch: OwnerEpoch;
      state: CacheReadState;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'registered';
      tabId: string;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'become-owner';
      scope: string;
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
      ownerLockName: string;
      hotCapacity?: number;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'cache-message';
      message: WorkerMessage;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'terminate-engine';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'retire-complete';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-startup';
      ownerEpoch: OwnerEpoch;
      phase: EngineStartupPhase;
      databaseAction: DatabaseAction;
      timeoutMs: number;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-replaced';
      ownerEpoch: OwnerEpoch;
      /** Whether this engine reopened durable data or created/reset it. */
      openOutcome: EngineOpenOutcome;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'protocol-error';
      error: string;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'terminal-error';
      error: string;
      storageUntouched?: true;
    }
  | {
      /** Another context holds the database; stop using the cache until reload. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'cache-unavailable';
      reason: string;
    }
  | {
      /** A newer app build took the database over. The page stops using the
       * cache and reloads into that build. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'cache-superseded';
      reason: string;
    }
  | {
      /** No other build has live tabs, so the owner may delete stale databases. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'remove-stale-databases';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    };

export type PageToEngineEnvelope = {
  coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
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
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'open-engine';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-request';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      request: CacheRequest;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'drain-engine';
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'heartbeat';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
    };

export type EngineToCoordinatorEnvelope =
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-assets-ready';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      /** Holds the owner lock, has not touched storage, awaits `open-engine`. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'owner-lock-acquired';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      /** The owner lock was held elsewhere on this attempt; retrying. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'owner-lock-busy';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      /** Gave up on the owner lock without touching storage. */
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'owner-lock-unavailable';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-ready';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      ownerLockName: string;
      ownerLockHeld: true;
      databaseActionProof: DatabaseActionProof;
      openOutcome: EngineOpenOutcome;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-response';
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      response: CacheResponse;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-push';
      ownerEpoch: OwnerEpoch;
      push: CachePush;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-drained';
      tabId: string;
      ownerEpoch: OwnerEpoch;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'engine-fatal';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      fatalCode: EngineFatalCode;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'activation-failed';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
      failureCode: ActivationFailureCode;
    }
  | {
      coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
      kind: 'heartbeat-ack';
      ownerEpoch: OwnerEpoch;
      heartbeatId: number;
    };

/** Starts a disposable worker that deletes this scope's stale databases. */
export type PageToCleanupEnvelope = {
  coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
  kind: 'remove-stale-databases';
  scope: string;
};

/** Tally from a stale-database cleanup worker. */
export type CleanupToPageEnvelope = {
  coordinatorVersion: typeof CACHE_COORDINATOR_PROTOCOL_VERSION;
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
  const isQueryOrMaintenanceRequest = (): boolean =>
    matchBranch(value)
      .with({ kind: 'entity-filter' }, (value): boolean => {
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
            'liveQuery',
          ]) &&
          isRecord(request.filters) &&
          ['CREATED_AT', 'UPDATED_AT', 'VIEWED_AT', 'VIEWED_UPDATED'].includes(
            request.sortMethod as string
          ) &&
          (request.sortDirection === 'ASC' ||
            request.sortDirection === 'DESC') &&
          isEntityFilterLimit(request) &&
          isOptionalEntityLiveQuery(request) &&
          isOptionalEntityMailView(request) &&
          isOptionalReconciliationBaseline(request)
        );
      })
      .with({ kind: 'calendar-range' }, (value): boolean => {
        return (
          hasOnlyKeys(value, ['id', 'kind', 'request']) &&
          isValidCalendarRangeArgs(value.request)
        );
      })
      .with({ kind: 'calendar-commit' }, (value): boolean => {
        return (
          hasOnlyKeys(value, ['id', 'kind', 'commit']) &&
          isValidCalendarCommitArgs(value.commit)
        );
      })
      .with({ kind: 'inspect-query' }, (value): boolean => {
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
      })
      .with({ kind: 'inspect-query-variants' }, (value): boolean => {
        return (
          hasOnlyKeys(value, [
            'id',
            'kind',
            'query',
            'operationName',
            'path',
          ]) &&
          isString(value.query) &&
          isOptionalString(value.operationName) &&
          isPath(value.path)
        );
      })
      .with({ kind: 'teardown' }, (value): boolean => {
        return (
          hasOnlyKeys(value, ['id', 'kind', 'opId']) && isString(value.opId)
        );
      })
      .with(
        { kind: 'invalidate' },
        { kind: 'delete-records' },
        (value): boolean => {
          return (
            hasOnlyKeys(value, ['id', 'kind', 'keys']) &&
            isStringArray(value.keys)
          );
        }
      )
      .with({ kind: 'clear' }, (value): boolean => {
        return hasOnlyKeys(value, ['id', 'kind']);
      })
      .otherwise((): boolean => {
        return false;
      });
  return matchBranch(value)
    .with({ kind: 'init' }, (value): boolean => {
      return (
        hasOnlyKeys(value, ['id', 'kind', 'scope', 'hotCapacity']) &&
        isNonEmptyString(value.scope) &&
        isOptionalPositiveInteger(value.hotCapacity)
      );
    })
    .with(
      { kind: 'current-revision' },
      { kind: 'current-storage-generation' },
      { kind: 'inspect-mutations' },
      (value): boolean => {
        return hasOnlyKeys(value, ['id', 'kind']);
      }
    )
    .with({ kind: 'read' }, (value): boolean => {
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
          'watch',
        ]) &&
        isOptionalString(value.opId) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        (value.priority === undefined || value.priority === 'user-visible') &&
        isEntityResolvers(value.entityResolvers) &&
        (value.watch === undefined ||
          (isRecord(value.watch) &&
            isNonEmptyString(value.opId) &&
            hasOnlyKeys(value.watch, ['since']) &&
            (value.watch.since === undefined ||
              isCacheRevision(value.watch.since))))
      );
    })
    .with({ kind: 'write' }, (value): boolean => {
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
    })
    .with({ kind: 'hydrate' }, (value): boolean => {
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
    })
    .with({ kind: 'enqueue-optimistic-mutation' }, (value): boolean => {
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
          'identityBindings',
          'uncertainCalendarEventKeys',
          'clientMetadata',
          'createdAtMs',
          'owner',
          'nowMs',
          'leaseExpiresAtMs',
        ]) &&
        (value.uncertainCalendarEventKeys === undefined ||
          (Array.isArray(value.uncertainCalendarEventKeys) &&
            value.uncertainCalendarEventKeys.length <= 256 &&
            value.uncertainCalendarEventKeys.every(
              isValidNormalizedRecordKey
            ))) &&
        isOptionalString(value.originOpId) &&
        isString(value.uuid) &&
        isString(value.query) &&
        isOptionalString(value.operationName) &&
        isOptionalRecord(value.variables) &&
        hasOwn(value, 'data') &&
        isOptionalArray(value.linkPatches) &&
        isOptionalArray(value.revalidations) &&
        isOptionalRecord(value.clientMetadata) &&
        isOptionalIdentityBindings(value) &&
        isSafeNonNegativeInteger(value.createdAtMs) &&
        isString(value.owner) &&
        isSafeNonNegativeInteger(value.nowMs) &&
        isSafeNonNegativeInteger(value.leaseExpiresAtMs)
      );
    })
    .with({ kind: 'claim-next-mutation' }, (value): boolean => {
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
    })
    .with({ kind: 'defer-optimistic-write' }, (value): boolean => {
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'transactionId',
          'leaseOwner',
          'leaseGeneration',
          'nextAttemptAtMs',
          'error',
          'serverFailure',
        ]) &&
        isString(value.transactionId) &&
        isString(value.leaseOwner) &&
        isString(value.leaseGeneration) &&
        isSafeNonNegativeInteger(value.nextAttemptAtMs) &&
        isString(value.error) &&
        (value.serverFailure === undefined ||
          typeof value.serverFailure === 'boolean')
      );
    })
    .with({ kind: 'commit-optimistic-write' }, (value): boolean => {
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
    })
    .with({ kind: 'rollback-optimistic-write' }, (value): boolean => {
      return (
        hasOnlyKeys(value, [
          'id',
          'kind',
          'transactionId',
          'leaseOwner',
          'leaseGeneration',
          'error',
          'errorCode',
        ]) &&
        isString(value.transactionId) &&
        isString(value.leaseOwner) &&
        isString(value.leaseGeneration) &&
        isString(value.error) &&
        isOptionalString(value.errorCode)
      );
    })
    .with({ kind: 'read-records-by-keys' }, (value): boolean => {
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
    })
    .with({ kind: 'search' }, (value): boolean => {
      return (
        hasOnlyKeys(value, ['id', 'kind', 'request']) &&
        isSearchRequest(value.request)
      );
    })
    .otherwise(isQueryOrMaintenanceRequest);
}

function isAttachEnginePortEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'enginePort',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isMessagePort(envelope.enginePort)
  );
}

function hasOwnerDepartureFields(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'reason',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isNonEmptyString(envelope.reason)
  );
}

function isRegisterTabEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'scope',
      'tabId',
      'livenessLockName',
      'visible',
      'hotCapacity',
      'buildTime',
    ]) &&
    isNonEmptyString(envelope.scope) &&
    isNonEmptyString(envelope.livenessLockName) &&
    typeof envelope.visible === 'boolean' &&
    isOptionalPositiveInteger(envelope.hotCapacity) &&
    isSafeNonNegativeInteger(envelope.buildTime)
  );
}

/** Validates an untrusted page-to-coordinator message. */
export function validateTabToCoordinatorEnvelope(
  value: unknown
): EnvelopeValidation<TabToCoordinatorEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  if (
    value.coordinatorVersion !== CACHE_COORDINATOR_PROTOCOL_VERSION ||
    !isNonEmptyString(value.tabId)
  )
    return fail('invalid coordinator tab identity');
  if (value.kind === 'tab-visibility') {
    return hasOnlyKeys(value, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'visible',
    ]) && typeof value.visible === 'boolean'
      ? pass({
          coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
          kind: 'tab-visibility',
          tabId: value.tabId,
          visible: value.visible,
        })
      : fail('invalid tab-visibility coordinator envelope');
  }

  const valid = matchBranch(value.kind)
    .with('register-tab', () => isRegisterTabEnvelope(value))
    .with(
      'cache-request',
      () =>
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'request',
        ]) && isCacheRequest(value.request)
    )
    .with('attach-engine-port', () => isAttachEnginePortEnvelope(value))
    .with(
      'graceful-departure',
      () =>
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'tabId',
          'ownerEpoch',
        ]) && isPositiveInteger(value.ownerEpoch)
    )
    .with('navigation-departure', () => hasOwnerDepartureFields(value))
    .with('engine-lost', () => hasOwnerDepartureFields(value))
    .with(
      'disconnect-tab',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'tabId', 'reason']) &&
        isNonEmptyString(value.reason)
    )
    .otherwise(() => false);
  return valid
    ? pass(value as TabToCoordinatorEnvelope)
    : fail(`invalid ${value.kind} coordinator envelope`);
}

function isEngineReplacedEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'ownerEpoch',
      'openOutcome',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isEngineOpenOutcome(envelope.openOutcome)
  );
}

function isTerminateEngineEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'reason',
    ]) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isNonEmptyString(envelope.reason)
  );
}

function isEngineStartupEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'ownerEpoch',
      'phase',
      'databaseAction',
      'timeoutMs',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isEngineStartupPhase(envelope.phase) &&
    isDatabaseAction(envelope.databaseAction) &&
    isPositiveInteger(envelope.timeoutMs)
  );
}

function isBecomeOwnerEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'scope',
      'tabId',
      'ownerEpoch',
      'databaseAction',
      'ownerLockName',
      'hotCapacity',
    ]) &&
    isNonEmptyString(envelope.scope) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isDatabaseAction(envelope.databaseAction) &&
    isNonEmptyString(envelope.ownerLockName) &&
    isOptionalPositiveInteger(envelope.hotCapacity)
  );
}

/** Validates an untrusted coordinator-to-page message. */
export function validateCoordinatorToTabEnvelope(
  value: unknown
): EnvelopeValidation<CoordinatorToTabEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  if (value.kind === 'cache-read-availability') {
    return hasOnlyKeys(value, [
      'coordinatorVersion',
      'kind',
      'ownerEpoch',
      'state',
    ]) &&
      isSafeNonNegativeInteger(value.ownerEpoch) &&
      (value.state === 'waiting' ||
        value.state === 'blocked' ||
        value.state === 'ready') &&
      (value.ownerEpoch > 0 || value.state === 'waiting')
      ? pass({
          coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
          kind: 'cache-read-availability',
          ownerEpoch: value.ownerEpoch,
          state: value.state,
        })
      : fail('invalid cache-read-availability coordinator envelope');
  }
  const valid = matchBranch(value.kind)
    .with(
      'registered',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'tabId']) &&
        isNonEmptyString(value.tabId)
    )
    .with('become-owner', () => isBecomeOwnerEnvelope(value))
    .with(
      'cache-message',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'message']) &&
        isWorkerMessage(value.message)
    )
    .with('terminate-engine', () => isTerminateEngineEnvelope(value))
    .with('retire-complete', () => hasTabOwnerFields(value))
    .with('engine-startup', () => isEngineStartupEnvelope(value))
    .with('engine-replaced', () => isEngineReplacedEnvelope(value))
    .with(
      'terminal-error',
      () =>
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
    .with(
      'protocol-error',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'error']) &&
        isNonEmptyString(value.error)
    )
    .with(
      'cache-unavailable',
      'cache-superseded',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'reason']) &&
        isNonEmptyString(value.reason)
    )
    .with('remove-stale-databases', () => hasTabOwnerFields(value))
    .otherwise(() => false);
  return valid
    ? pass(value as CoordinatorToTabEnvelope)
    : fail(`invalid ${value.kind} coordinator envelope`);
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
  const valid = matchBranch(value.kind)
    .with(
      'engine-request',
      () =>
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
    )
    .with(
      'open-engine',
      'drain-engine',
      () =>
        hasOnlyKeys(value, ['coordinatorVersion', 'kind', 'ownerEpoch']) &&
        isPositiveInteger(value.ownerEpoch)
    )
    .with(
      'heartbeat',
      () =>
        hasOnlyKeys(value, [
          'coordinatorVersion',
          'kind',
          'ownerEpoch',
          'heartbeatId',
        ]) &&
        isPositiveInteger(value.ownerEpoch) &&
        isPositiveInteger(value.heartbeatId)
    )
    .otherwise(() => false);
  return valid
    ? pass(value as CoordinatorToEngineEnvelope)
    : fail(`invalid ${value.kind} coordinator envelope`);
}

function isHeartbeatAckEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'ownerEpoch',
      'heartbeatId',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isPositiveInteger(envelope.heartbeatId)
  );
}

function isEnginePushEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'ownerEpoch',
      'push',
    ]) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isCachePush(envelope.push)
  );
}

function isActivationFailedEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'reason',
      'failureCode',
    ]) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isNonEmptyString(envelope.reason) &&
    isActivationFailureCode(envelope.failureCode)
  );
}

function isEngineFatalEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'reason',
      'fatalCode',
    ]) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isNonEmptyString(envelope.reason) &&
    isEngineFatalCode(envelope.fatalCode)
  );
}

function isEngineReadyEnvelope(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
      'ownerLockName',
      'ownerLockHeld',
      'databaseActionProof',
      'openOutcome',
    ]) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch) &&
    isNonEmptyString(envelope.ownerLockName) &&
    envelope.ownerLockHeld === true &&
    isDatabaseActionProof(envelope.databaseActionProof) &&
    isEngineOpenOutcome(envelope.openOutcome)
  );
}

/** Validates an untrusted engine-to-coordinator direct-port message. */
export function validateEngineToCoordinatorEnvelope(
  value: unknown
): EnvelopeValidation<EngineToCoordinatorEnvelope> {
  if (!isRecord(value) || !hasVersion(value) || !isString(value.kind)) {
    return fail('invalid coordinator envelope header');
  }
  const valid = matchBranch(value.kind)
    .with('engine-ready', () => isEngineReadyEnvelope(value))
    .with(
      'engine-response',
      () =>
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
    )
    .with('engine-push', () => isEnginePushEnvelope(value))
    .with(
      'engine-assets-ready',
      'owner-lock-acquired',
      'owner-lock-busy',
      'owner-lock-unavailable',
      'engine-drained',
      () => hasTabOwnerFields(value)
    )
    .with('engine-fatal', () => isEngineFatalEnvelope(value))
    .with('activation-failed', () => isActivationFailedEnvelope(value))
    .with('heartbeat-ack', () => isHeartbeatAckEnvelope(value))
    .otherwise(() => false);
  return valid
    ? pass(value as EngineToCoordinatorEnvelope)
    : fail(`invalid ${value.kind} coordinator envelope`);
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
  schemaCompatibilityEpoch: 4,
  formatVersion: 4,
  storageSchemaVersion: 11,
} as const;

/**
 * Storage versions in use when database names began to embed versions; a
 * build at exactly these keeps the unversioned name. Mirrors
 * `UNVERSIONED_STORAGE_VERSIONS` in cache-core.
 */
export const UNVERSIONED_STORAGE_VERSION = {
  schemaCompatibilityEpoch: 3,
  formatVersion: 3,
  storageSchemaVersion: 11,
} as const;

const DATABASE_PREFIX = 'graphql-cache:';

type StorageVersionTuple = readonly [number, number, number];

const versionTuple = (
  version: typeof CACHE_STORAGE_VERSION | typeof UNVERSIONED_STORAGE_VERSION
): StorageVersionTuple => [
  version.schemaCompatibilityEpoch,
  version.formatVersion,
  version.storageSchemaVersion,
];

/** Compared as a tuple, like the WASM: the first version that differs decides. */
const compareVersions = (
  left: StorageVersionTuple,
  right: StorageVersionTuple
): number => {
  const index = left.findIndex((version, at) => version !== right[at]);
  return index < 0 ? 0 : (left[index] ?? 0) - (right[index] ?? 0);
};

/** Mirrors `cache_database_name`: the physical database this build opens. */
export function cacheDatabaseIdentity(scope: string): string {
  const unversioned = `${DATABASE_PREFIX}${scope}`;
  const own = versionTuple(CACHE_STORAGE_VERSION);
  if (compareVersions(own, versionTuple(UNVERSIONED_STORAGE_VERSION)) === 0) {
    return unversioned;
  }
  return `${unversioned}:s${own[0]}.v${own[1]}.t${own[2]}`;
}

/**
 * Whether `identity` is one of this scope's databases that this build does
 * not open and that no newer build could want: the unversioned name once this
 * build's versions have moved past it, or another name for versions no newer
 * than this build's. A newer version belongs to a build that may come back,
 * for example after a rollback. Mirrors the WASM's own check.
 */
export function isStaleCacheDatabaseIdentity(
  scope: string,
  identity: string
): boolean {
  const unversioned = `${DATABASE_PREFIX}${scope}`;
  const version =
    identity === unversioned
      ? versionTuple(UNVERSIONED_STORAGE_VERSION)
      : storageVersion(unversioned, identity);
  return (
    identity !== cacheDatabaseIdentity(scope) &&
    version !== undefined &&
    compareVersions(version, versionTuple(CACHE_STORAGE_VERSION)) <= 0
  );
}

/** The `[epoch, format, storage]` versions embedded in a database name. */
function storageVersion(
  unversioned: string,
  identity: string
): StorageVersionTuple | undefined {
  if (!identity.startsWith(unversioned)) return;
  const match = /^:s(\d+)\.v(\d+)\.t(\d+)$/.exec(
    identity.slice(unversioned.length)
  );
  if (!match) return;
  const [epoch, format, storage] = match.slice(1).map(Number);
  if (
    !Number.isSafeInteger(epoch) ||
    !Number.isSafeInteger(format) ||
    !Number.isSafeInteger(storage)
  ) {
    return;
  }
  return [epoch ?? 0, format ?? 0, storage ?? 0];
}

/** Mirrors turso-opfs's canonical lock derivation without exposing a new lock. */
export function databaseOwnerLockName(scope: string): string {
  const databaseIdentity = cacheDatabaseIdentity(scope);
  const byteLength = new TextEncoder().encode(databaseIdentity).byteLength;
  return `macro:turso-opfs:v1:${byteLength}:${databaseIdentity}`;
}

function hasTabOwnerFields(envelope: UnknownRecord) {
  return (
    hasOnlyKeys(envelope, [
      'coordinatorVersion',
      'kind',
      'tabId',
      'ownerEpoch',
    ]) &&
    isNonEmptyString(envelope.tabId) &&
    isPositiveInteger(envelope.ownerEpoch)
  );
}

function isOptionalEntityLiveQuery(request: UnknownRecord): boolean {
  return (
    request.liveQuery === undefined ||
    (isRecord(request.liveQuery) &&
      hasOnlyKeys(request.liveQuery, [
        'id',
        'document',
        'fragmentName',
        'since',
        'release',
      ]) &&
      typeof request.liveQuery.id === 'string' &&
      request.liveQuery.id.length > 0 &&
      request.liveQuery.id.length <= 128 &&
      typeof request.liveQuery.document === 'string' &&
      request.liveQuery.document.length > 0 &&
      typeof request.liveQuery.fragmentName === 'string' &&
      request.liveQuery.fragmentName.length > 0 &&
      (request.liveQuery.since === undefined ||
        isCacheRevision(request.liveQuery.since)) &&
      (request.liveQuery.release === undefined ||
        typeof request.liveQuery.release === 'boolean') &&
      request.mail === undefined &&
      request.baseline !== undefined)
  );
}

/** A Mail read through a position takes `limit` as its fewest rows. */
function isEntityFilterLimit(request: UnknownRecord): boolean {
  const through = isRecord(request.mail) ? request.mail.through : undefined;
  return through === undefined
    ? isValidCacheSearchLimit(request.limit)
    : Number.isSafeInteger(request.limit) &&
        (request.limit as number) >= 1 &&
        (request.limit as number) <= MAX_MAIL_THROUGH_ROWS;
}

function isOptionalEntityMailView(request: UnknownRecord): boolean {
  const mail = request.mail;
  if (mail === undefined) return true;
  if (!isRecord(mail)) return false;
  const through = mail.through;
  return (
    hasOnlyKeys(mail, ['view', 'cursor', 'through']) &&
    ['ALL', 'INBOX', 'DRAFTS', 'SENT'].includes(mail.view as string) &&
    (through === undefined
      ? (request.limit as number) < 500
      : mail.cursor === undefined &&
        typeof through === 'string' &&
        through.length <= 4096) &&
    (request.baseline === undefined || mail.cursor === undefined) &&
    (mail.cursor === undefined ||
      (typeof mail.cursor === 'string' && mail.cursor.length <= 4096))
  );
}

function isOptionalReconciliationBaseline(request: UnknownRecord): boolean {
  return (
    request.baseline === undefined ||
    (Array.isArray(request.baseline) &&
      request.baseline.length <= MAX_RECONCILIATION_BASELINE &&
      request.baseline.every(
        (entry) =>
          isRecord(entry) &&
          hasOnlyKeys(entry, ['key', 'sortTimestamp']) &&
          isValidNormalizedRecordKey(entry.key) &&
          typeof entry.sortTimestamp === 'string' &&
          entry.sortTimestamp.length <= 64
      ))
  );
}

function isOptionalIdentityBindings(value: UnknownRecord): boolean {
  return (
    value.identityBindings === undefined ||
    (Array.isArray(value.identityBindings) &&
      value.identityBindings.length <= 32 &&
      value.identityBindings.every(
        (binding) =>
          isRecord(binding) &&
          hasOnlyKeys(binding, [
            'localKey',
            'responsePath',
            'referenceFields',
            'revalidationVariables',
            'deleteRecord',
          ]) &&
          (binding.deleteRecord === undefined ||
            typeof binding.deleteRecord === 'boolean') &&
          isValidNormalizedRecordKey(binding.localKey) &&
          Array.isArray(binding.responsePath) &&
          binding.responsePath.length <= 16 &&
          binding.responsePath.every(isString) &&
          (binding.referenceFields === undefined ||
            (Array.isArray(binding.referenceFields) &&
              binding.referenceFields.every(isString))) &&
          (binding.revalidationVariables === undefined ||
            (Array.isArray(binding.revalidationVariables) &&
              binding.revalidationVariables.every(isString)))
      ))
  );
}

function isOptionalArray(value: unknown): boolean {
  return value === undefined || Array.isArray(value);
}
