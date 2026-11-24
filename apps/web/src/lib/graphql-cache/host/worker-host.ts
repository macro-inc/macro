import type { MutationInspection } from '../protocol';

/**
 * Browser CacheHost: routes cache RPC through the SharedWorker coordinator to
 * the currently elected dedicated cache engine. Unsupported browsers receive
 * a storage-free no-op host.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { match } from 'ts-pattern';
import {
  type AuthorityTransition,
  type CacheAuthority,
  cacheAuthorityError,
  createAuthorityObserver,
  StaleCacheAuthorityError,
} from '../authority';
import { UNKNOWN_CACHE_GENERATION } from '../generation-mirror';
import { deleteLegacyNormalizedCacheIdb } from '../legacy-idb-cleanup';
import { createPeopleCache } from '../people/host';
import {
  ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
  type AffectedOperationsResult,
  CACHE_SUPERSEDED_ERROR_CODE,
  type CachedQueryInstanceWire,
  type CachedQueryVariantWire,
  type CacheRequest,
  type CacheResponseErrorCode,
  type CacheRevision,
  type CalendarCommitArgs,
  type CalendarCommitCacheResult,
  type CalendarRangeCacheArgs,
  type CalendarRangeCacheResult,
  type ClaimedMutation,
  type CommitOptimisticWriteResult,
  type DeferOptimisticWriteResult,
  type EnqueueOptimisticMutationResult,
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  type HydrationResult,
  isCachePush,
  isCacheResponse,
  isTypedSearch,
  type MutationClaim,
  type MutationSettlement,
  OWNER_EPOCH_LOST_ERROR_CODE,
  OWNER_HANDOFF_BLOCKED_ERROR_CODE,
  OWNER_LOCK_UNAVAILABLE_ERROR_CODE,
  parseStorageGeneration,
  type QueryUpdate,
  type ReadRecordsByKeysArgs,
  type ReadRecordsByKeysResult,
  type ReadResult,
  type RollbackOptimisticWriteResult,
  type SearchCacheArgs,
  type SearchCachePage,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
  type WriteResult,
} from '../protocol';
import { quarantineCacheScope } from '../scope';
import {
  type CacheRolloutCohort,
  type CacheTelemetryRecorderLike,
  type CacheTelemetrySink,
  type CacheUnavailableReason,
  classifyCacheError,
  describeCacheError,
  isolateCacheTelemetry,
  operationCategoryForRequest,
} from '../telemetry';
import { createPageCacheTelemetry } from '../telemetry-relay';
import {
  type CacheCoordinatorPageAdapter,
  createCacheCoordinatorPageAdapter,
} from '../worker/coordinator-page-adapter';
import type { EngineOpenOutcome } from '../worker/coordinator-protocol';
import { WorkerRestartedError } from '../worker/effect-worker-transport';
import { isUnambiguousCacheScope } from '../worker/stale-databases';
import {
  CacheBootstrapExhaustedError,
  COORDINATOR_CONNECT_ATTEMPTS,
  COORDINATOR_CONNECT_RETRY_DELAYS_MS,
  COORDINATOR_CONNECT_TIMEOUT_MS,
  STARTUP_RESPONSE_GRACE_MS,
} from '../worker/startup';
import { unsupportedBrowserReason } from './browser-support';
import { CacheHostDisposedError, CacheRequestTimeoutError } from './errors';
import { CacheNavigationError } from './navigation-error';
import { createNoopCacheHost } from './noop-host';
import {
  CacheReadAvailability,
  cacheRequestStamp,
  isReadOnlyCacheRequest,
} from './read-availability';
import type {
  AffectedOperationsListener,
  CacheChangeListener,
  CacheChangeOptions,
  CacheGenerationChange,
  CacheHost,
  CacheHydrateArgs,
  CacheReadArgs,
  CacheWriteArgs,
  EnqueueOptimisticMutationArgs,
  InitialMutationClaimArgs,
  InspectQueryArgs,
  InspectQueryVariantsArgs,
} from './types';
import { visibleTimeout } from './visible-timeout';

type Pending = {
  authorityGeneration?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  kind: CacheRequest['kind'];
  /** Stays queued for the replacement engine when a handoff blocks reads. */
  typedSearch: boolean;
  opKey?: number;
  admitted: boolean;
  startedAt: number;
  /** Waiting for an owner, which a hidden page may do for as long as it likes. */
  waiting: boolean;
  stopTimeout?: () => void;
};

function isInitializationRequest(kind: CacheRequest['kind']): boolean {
  return kind === 'init' || kind === 'current-authority';
}

type HostState =
  | 'idle'
  | 'initializing'
  | 'awaiting-replacement'
  | 'ready'
  | 'suspended'
  | 'disposing'
  | 'failed'
  | 'disposed';

/** `Omit` that distributes over union members. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface WorkerHostOptions {
  scope: string;
  hotCapacity?: number;
  /**
   * Read-only request timeout in ms (default 10s), for the wait until an owner
   * is ready and then again for its answer. A hung worker rejects cache reads;
   * mutating requests remain pending so callers cannot retry an operation that
   * may already have completed durably.
   */
  requestTimeoutMs?: number;
  /**
   * Overrides each startup-phase timeout (primarily for tests). By default,
   * registration has its own budget and engine startup follows the coordinator's
   * asset/open deadlines, with a response grace period.
   */
  initializationTimeoutMs?: number;
  /** Reports terminal initialization or coordinator-transport failure. */
  onInitializationError?: (error: Error) => void;
  /** A newer app build took the local cache over. The host has already
   * retired to the network; the app should reload the page into that build. */
  onSuperseded?: () => void;
  /** Allowlisted rollout cohort attached to browser-cache telemetry. */
  rolloutCohort?: CacheRolloutCohort;
  /** Injectable recorder for deterministic tests or alternate exporters. */
  telemetry?: CacheTelemetryRecorderLike;
  /** Injectable final sink; defaults to anonymous OpenTelemetry spans. */
  telemetrySink?: CacheTelemetrySink;
  /** Test seams for bounded origin-storage-pressure sampling. */
  storageHealthIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/** How often a ready owner may leave an authority read unanswered before the
 * read fails and its page can start over on a new host. */
export const UNANSWERED_AUTHORITY_READS = 3;
const DEFAULT_STORAGE_HEALTH_INTERVAL_MS = 5 * 60_000;
const MIN_STORAGE_HEALTH_INTERVAL_MS = 1_000;
const MAX_STORAGE_HEALTH_INTERVAL_MS = 15 * 60_000;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

class CacheResponseError extends Error {
  constructor(
    message: string,
    readonly errorCode?: CacheResponseErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CacheResponseError';
  }
}

/**
 * The coordinator SharedWorker restarted under this page (Safari can reconnect
 * a port to an empty worker global). It rejects the requests the restart cut
 * off, and ends the host once restarts used up the connect attempts before a
 * handshake completed. Either way the database is preserved and its scope is
 * not quarantined, so the page may build a new host later.
 */
export class CoordinatorRestartedError extends CacheResponseError {
  constructor(options?: ErrorOptions) {
    super(
      'cache coordinator transport restarted',
      OWNER_EPOCH_LOST_ERROR_CODE,
      options
    );
    this.name = 'CoordinatorRestartedError';
  }
}

/**
 * The cache failed closed: another context holds the database, or a newer
 * build took it over. The page stays on the network; `unavailableReason`
 * says why when the coordinator told it, and `phase` whether the host had
 * finished starting.
 */
export class CacheUnavailableError extends CacheResponseError {
  constructor(
    message: string,
    superseded: boolean,
    readonly unavailableReason: CacheUnavailableReason | undefined,
    readonly phase: 'initialization' | 'operation'
  ) {
    super(
      message,
      superseded
        ? CACHE_SUPERSEDED_ERROR_CODE
        : OWNER_LOCK_UNAVAILABLE_ERROR_CODE
    );
    this.name = 'CacheUnavailableError';
  }
}

const isOwnerEpochLoss = (error: unknown): error is CacheResponseError =>
  error instanceof CacheResponseError &&
  error.errorCode === OWNER_EPOCH_LOST_ERROR_CODE;

const isOwnerLockUnavailable = (error: unknown): error is CacheResponseError =>
  error instanceof CacheResponseError &&
  (error.errorCode === OWNER_LOCK_UNAVAILABLE_ERROR_CODE ||
    error.errorCode === CACHE_SUPERSEDED_ERROR_CODE);

export function createWorkerCacheHost(options: WorkerHostOptions): CacheHost {
  const authorityObserver = createAuthorityObserver(options.scope);
  let pageTelemetry = options.telemetry
    ? undefined
    : createPageCacheTelemetry({
        rolloutCohort: options.rolloutCohort ?? 'unknown',
        sink: options.telemetrySink,
      });
  let telemetry = isolateCacheTelemetry(
    options.telemetry ?? pageTelemetry?.recorder
  );
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  const unsupportedReason =
    unsupportedBrowserReason() ??
    (isUnambiguousCacheScope(options.scope)
      ? undefined
      : 'cache scope must not end with -wal');
  if (unsupportedReason) {
    telemetry?.record({
      name: 'graphql_cache.host_ready',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: 'unsupported',
    });
    telemetry?.flush();
    console.warn(`[graphql-cache] disabled: ${unsupportedReason}`);
    return createNoopCacheHost();
  }

  const clientId = crypto.randomUUID();
  const pending = new Map<number, Pending>();
  const readAvailability = new CacheReadAvailability();
  const activeOpKeys = new Set<number>();
  const registeredOpKeys = new Set<number>();
  const lostRegisteredOpKeys = new Set<number>();
  const replacementReadOpKeys = new Set<number>();
  const affectedSubscribers = new Set<AffectedOperationsListener>();
  const cacheChangeSubscribers = new Set<CacheChangeListener>();
  const hydrationSubscribers = new Set<CacheChangeListener>();
  const generationChangeSubscribers = new Set<
    (change: CacheGenerationChange) => void
  >();
  const settlementSubscribers = new Set<
    (settlement: MutationSettlement) => void
  >();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let initializationTimeoutMs =
    options.initializationTimeoutMs ?? COORDINATOR_CONNECT_TIMEOUT_MS;
  let registrationInProgress = false;
  let cancelRegistration: ((error: Error) => void) | undefined;
  let nextRequestId = 1;
  let state: HostState = 'idle';
  let initialization: Promise<void> | undefined;
  let initializationAttempt = 0;
  let transportGeneration = 0;
  let transportInterruption: Error | undefined;
  let reconnects = 0;
  let suspension: Promise<void> | undefined;
  let initializationError: Error | undefined;
  let replacementError: CacheResponseError | undefined;
  let recoveryInProgress = false;
  const transportWaiters = new Set<() => void>();
  let latestReplacementEpoch = 0;
  let failureReported = false;
  let terminalFailureHandled = false;
  let superseded = false;
  let adapter: CacheCoordinatorPageAdapter | undefined;
  let registeredAdapter: CacheCoordinatorPageAdapter | undefined;
  let adapterDisposePromise: Promise<void> | undefined;
  let adapterDisposeWasGraceful = false;
  let adapterDisposalStarted = false;
  let disposalMode: 'draining' | 'leaving' | 'navigation' | undefined;
  let pagehideRegistered = false;
  let legacyIdbDeletionStarted = false;
  let telemetryRelayStarted = false;
  let telemetryFinished = false;
  let initializationStartedAt = 0;
  let storageHealthTimer: ReturnType<typeof setInterval> | undefined;
  const setIntervalFn =
    options.setInterval ?? globalThis.setInterval.bind(globalThis);
  const clearIntervalFn =
    options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
  const storageHealthIntervalMs = Math.min(
    Math.max(
      options.storageHealthIntervalMs ?? DEFAULT_STORAGE_HEALTH_INTERVAL_MS,
      MIN_STORAGE_HEALTH_INTERVAL_MS
    ),
    MAX_STORAGE_HEALTH_INTERVAL_MS
  );

  const recordRequestOutcome = (
    entry: Pending,
    outcome: 'success' | 'error',
    error?: unknown
  ): void => {
    telemetry?.record({
      name: 'graphql_cache.host_request',
      operationCategory: operationCategoryForRequest({ kind: entry.kind }),
      outcome,
      errorCode: outcome === 'error' ? classifyCacheError(error) : 'none',
      durationMs: now() - entry.startedAt,
    });
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    const msg = event.data;
    if (isCachePush(msg)) {
      if (msg.kind === 'authority-changed') {
        try {
          authorityObserver.observe(msg.authority);
        } catch (error) {
          Telemetry.error(error);
        }
        return;
      }
      const currentAuthority =
        msg.authorityGeneration !== undefined &&
        msg.authorityGeneration === authorityObserver.snapshot()?.generation;
      if (msg.kind === 'cache-hydrated') {
        for (const cb of hydrationSubscribers) {
          if (!currentAuthority) cb(msg.revision);
          else
            cb(msg.revision, {
              searchChangedBuckets: msg.searchChangedBuckets,
              unchangedViews: msg.unchangedViews,
            });
        }
        return;
      }
      if (msg.kind === 'cache-changed') {
        if (msg.reset) {
          emitGenerationChange({ storage: 'reset' });
        }
        for (const cb of cacheChangeSubscribers) {
          if (
            msg.reset ||
            !currentAuthority ||
            (msg.searchChangedBuckets === undefined &&
              msg.unchangedViews === undefined)
          )
            cb(msg.revision);
          else
            cb(msg.revision, {
              searchChangedBuckets: msg.searchChangedBuckets,
              unchangedViews: msg.unchangedViews,
            });
        }
        return;
      }
      if (msg.kind === 'mutation-settled') {
        for (const cb of settlementSubscribers) cb(msg.settlement);
        return;
      }
      const prefix = `${clientId}:`;
      const opKeys = [
        ...new Set(
          msg.opIds.flatMap((id) => {
            if (!id.startsWith(prefix)) return [];
            const suffix = id.slice(prefix.length);
            const opKey = Number(suffix);
            return Number.isSafeInteger(opKey) && String(opKey) === suffix
              ? [opKey]
              : [];
          })
        ),
      ];
      if (opKeys.length > 0) {
        for (const cb of affectedSubscribers) {
          if (currentAuthority && msg.fieldChanges)
            cb(opKeys, msg.fieldChanges);
          else cb(opKeys);
        }
      }
      return;
    }
    if (!isCacheResponse(msg)) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (!msg.ok) {
      const error = new CacheResponseError(msg.error, msg.errorCode);
      if (isOwnerEpochLoss(error)) observeOwnerEpochLoss(error);
      pending.delete(msg.id);
      entry.stopTimeout?.();
      recordRequestOutcome(entry, 'error', error);
      entry.reject(cacheAuthorityError(error));
      if (isOwnerLockUnavailable(error))
        retireUnavailable(msg.error, {
          superseded: error.errorCode === CACHE_SUPERSEDED_ERROR_CODE,
        });
      finishGracefulDisposeIfDrained();
      return;
    }
    pending.delete(msg.id);
    entry.stopTimeout?.();
    if (
      isReadOnlyCacheRequest(entry.kind) &&
      (msg.authorityGeneration ?? entry.authorityGeneration) !==
        authorityObserver.snapshot()?.generation
    ) {
      const error = new StaleCacheAuthorityError();
      recordRequestOutcome(entry, 'error', error);
      entry.reject(error);
      finishGracefulDisposeIfDrained();
      return;
    }
    if (
      (entry.kind === 'read' || entry.kind === 'write') &&
      entry.opKey !== undefined &&
      activeOpKeys.has(entry.opKey)
    ) {
      registeredOpKeys.add(entry.opKey);
    }
    recordRequestOutcome(entry, 'success');
    entry.resolve(msg.result);
    finishGracefulDisposeIfDrained();
  };

  function beginRecoveryGeneration(): void {
    if (recoveryInProgress) return;
    recoveryInProgress = true;
    lostRegisteredOpKeys.clear();
    for (const opKey of registeredOpKeys) lostRegisteredOpKeys.add(opKey);
    registeredOpKeys.clear();
  }

  function markPendingRegistrations(target: Set<number>): void {
    for (const entry of pending.values()) {
      if (
        (entry.kind === 'read' || entry.kind === 'write') &&
        entry.opKey !== undefined
      ) {
        target.add(entry.opKey);
      }
    }
  }

  function emitAffectedKeys(opKeys: number[]): void {
    if (opKeys.length === 0) return;
    for (const cb of affectedSubscribers) cb(opKeys);
  }

  function emitGenerationChange(change: CacheGenerationChange): void {
    // A transport replacement can preserve the durable permission generation.
    // Keep its witness until the replacement handshake reads the owner again;
    // stale generations are still rejected by the owner and response checks.
    // Reactive observers can unsubscribe and resubscribe during notification.
    // A live Set iterator would keep visiting the replacement subscriptions.
    for (const cb of [...generationChangeSubscribers]) {
      if (generationChangeSubscribers.has(cb)) cb(change);
    }
  }

  function onEngineReplaced(
    ownerEpoch: number,
    openOutcome: EngineOpenOutcome
  ): void {
    if (
      state === 'failed' ||
      state === 'suspended' ||
      state === 'disposing' ||
      state === 'disposed'
    )
      return;
    if (ownerEpoch <= latestReplacementEpoch) return;
    latestReplacementEpoch = ownerEpoch;
    resumeCacheReads();
    // Initial readiness completes the already-running first handshake.
    if (state === 'initializing' && !recoveryInProgress) return;
    const change: CacheGenerationChange = {
      storage: openOutcome === 'opened-existing' ? 'preserved' : 'reset',
    };
    emitGenerationChange(change);
    if (state === 'ready') {
      beginRecoveryGeneration();
      // No old response put this host into recovery. Requests still pending at
      // replacement broadcast were queued by the coordinator while resetting
      // and will be routed exactly once to this replacement generation.
      markPendingRegistrations(replacementReadOpKeys);
    }
    if (state !== 'ready' && state !== 'awaiting-replacement') return;
    void startInitialization().catch(() => undefined);
  }

  function resumeCacheReads(): void {
    if (state === 'failed' || state === 'suspended' || state === 'disposed')
      return;
    readAvailability.resume();
    for (const [id, entry] of pending) {
      if (isInitializationRequest(entry.kind))
        armRequestTimeout(id, entry, initializationTimeoutMs);
      else if (isReadOnlyCacheRequest(entry.kind))
        armRequestTimeout(id, entry, requestTimeoutMs);
    }
  }

  function waitForCacheReads(): void {
    if (state === 'failed' || state === 'suspended' || state === 'disposed')
      return;
    readAvailability.wait();
    // Keep read/write/teardown admission ordered at the coordinator. Pausing
    // their deadlines must not create a separate page-side read queue.
    for (const [id, entry] of pending) {
      if (isInitializationRequest(entry.kind)) {
        entry.stopTimeout?.();
        entry.stopTimeout = undefined;
      } else if (isReadOnlyCacheRequest(entry.kind) && !entry.waiting) {
        armRequestTimeout(id, entry, requestTimeoutMs, true);
      }
    }
  }

  function onOwnerHandoffBlocked(): void {
    if (state === 'failed' || state === 'suspended' || state === 'disposed')
      return;
    const error = new CacheResponseError(
      'cache reads unavailable after owner handoff timeout',
      OWNER_HANDOFF_BLOCKED_ERROR_CODE
    );
    beginRecoveryGeneration();
    for (const key of activeOpKeys) lostRegisteredOpKeys.add(key);
    replacementReadOpKeys.clear();
    readAvailability.block(error);
    // Cancel only the callers, not initialization or admitted worker fibers.
    // Writes remain queued until the engine has safely drained and reopened.
    for (const [id, entry] of pending) {
      if (isInitializationRequest(entry.kind)) {
        entry.stopTimeout?.();
        entry.stopTimeout = undefined;
      }
      if (!isReadOnlyCacheRequest(entry.kind)) continue;
      // A typed search has no network fallback to hurry to. The coordinator
      // still holds it for the replacement engine, so refusing it would only
      // drop its place in line and leave the caller to ask again behind the
      // rest. A host on its way out keeps nothing waiting.
      if (entry.typedSearch && state !== 'disposing') {
        // An owner change that never completes must still end the wait.
        entry.stopTimeout?.();
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          recordRequestOutcome(entry, 'error', error);
          entry.reject(error);
          finishGracefulDisposeIfDrained();
        }, requestTimeoutMs);
        entry.stopTimeout = () => clearTimeout(timer);
        continue;
      }
      pending.delete(id);
      entry.stopTimeout?.();
      recordRequestOutcome(entry, 'error', error);
      entry.reject(error);
    }
    finishGracefulDisposeIfDrained();
  }

  function observeOwnerEpochLoss(error: CacheResponseError): void {
    if (
      state === 'failed' ||
      state === 'suspended' ||
      state === 'disposing' ||
      state === 'disposed'
    )
      return;
    beginRecoveryGeneration();
    // A rejected old-epoch read may have registered dependencies before its
    // response was lost. It belongs to the lost generation, not replacement.
    markPendingRegistrations(lostRegisteredOpKeys);
    // A handshake is not over: it asks the next owner again. And in a handover
    // it announced, the coordinator keeps new requests for the next owner.
    if (state === 'initializing' || readAvailability.timeoutsPaused) return;
    replacementError = error;
    initialization = undefined;
    state = 'awaiting-replacement';
  }

  function unregisterPagehide(): void {
    if (!pagehideRegistered || typeof removeEventListener !== 'function') {
      return;
    }
    removeEventListener('pagehide', onPagehide);
    removeEventListener('pageshow', onPageshow);
    pagehideRegistered = false;
  }

  function registerPagehide(): void {
    if (pagehideRegistered || typeof addEventListener !== 'function') return;
    pagehideRegistered = true;
    addEventListener('pagehide', onPagehide);
    addEventListener('pageshow', onPageshow);
  }

  function getAdapter(): CacheCoordinatorPageAdapter {
    if (adapter) return adapter;
    if (!telemetryRelayStarted) {
      telemetryRelayStarted = true;
      pageTelemetry?.relay.start();
    }
    const created = createCacheCoordinatorPageAdapter({
      scope: options.scope,
      hotCapacity: options.hotCapacity,
      onEngineReplaced: (epoch, outcome) => {
        if (adapter === created) onEngineReplaced(epoch, outcome);
      },
      onCacheReadAvailabilityChanged: (availability) => {
        if (adapter !== created) return;
        match(availability)
          .with('ready', resumeCacheReads)
          .with('waiting', waitForCacheReads)
          .with('blocked', onOwnerHandoffBlocked)
          .exhaustive();
      },
      onStartupProgress: (progress) => {
        if (adapter !== created) return;
        initializationTimeoutMs =
          options.initializationTimeoutMs ??
          progress.timeoutMs + STARTUP_RESPONSE_GRACE_MS;
        for (const [id, entry] of pending) {
          if (
            isInitializationRequest(entry.kind) &&
            !readAvailability.timeoutsPaused
          )
            armRequestTimeout(id, entry, initializationTimeoutMs);
        }
      },
      onTerminalError: (error) => {
        // start() also rejects; let the bounded registration loop retry before
        // reporting a terminal failure or quarantining any cache scope.
        if (adapter !== created || registrationInProgress || suspension) return;
        if (error instanceof WorkerRestartedError) reconnectCoordinator(error);
        else failTransport(error);
      },
      onCacheUnavailable: (reason, supersededBuild, unavailableReason) => {
        if (adapter === created)
          retireUnavailable(reason, {
            superseded: supersededBuild,
            unavailableReason,
          });
      },
      onCacheSuperseded: (reason) => {
        if (adapter !== created || superseded) return;
        superseded = true;
        retireUnavailable(reason, {
          superseded: true,
          leaveForNewerBuild: true,
        });
        options.onSuperseded?.();
      },
      telemetry,
    });
    created.onmessage = (event) => {
      if (adapter === created && state !== 'suspended') onMessage(event);
    };
    adapter = created;
    registerPagehide();
    return created;
  }

  async function registerAdapter(initializationId: number): Promise<void> {
    registrationInProgress = true;
    try {
      for (
        let attempt = 0;
        attempt < COORDINATOR_CONNECT_ATTEMPTS;
        attempt += 1
      ) {
        // Cancellation may arrive after a retry timer fires, before this continuation.
        if (initializationId !== initializationAttempt)
          throw new CacheNavigationError();
        if (state !== 'initializing') throw new CacheHostDisposedError();
        const current = getAdapter();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            current.start(),
            new Promise<never>((_resolve, reject) => {
              cancelRegistration = reject;
              timer = setTimeout(
                () => reject(new CacheRequestTimeoutError('registration')),
                options.initializationTimeoutMs ??
                  COORDINATOR_CONNECT_TIMEOUT_MS
              );
            }),
          ]);
          if (initializationId !== initializationAttempt)
            throw new CacheNavigationError();
          if (state !== 'initializing') throw new CacheHostDisposedError();
          registeredAdapter = current;
          return;
        } catch (error) {
          current.onmessage = null;
          await current.dispose({ graceful: false });
          if (adapter === current) adapter = undefined;
          if (
            initializationId !== initializationAttempt ||
            state !== 'initializing' ||
            attempt + 1 === COORDINATOR_CONNECT_ATTEMPTS
          )
            throw error;
          if (timer !== undefined) clearTimeout(timer);
          const retryStartedAt = now();
          let completed = false;
          try {
            await new Promise<void>((resolve, reject) => {
              cancelRegistration = reject;
              timer = setTimeout(
                resolve,
                COORDINATOR_CONNECT_RETRY_DELAYS_MS[attempt]
              );
            });
            completed = true;
          } finally {
            telemetry.record({
              name: 'graphql_cache.registration_retry',
              operationCategory: 'initialization',
              outcome: completed ? 'success' : 'abrupt',
              ...describeCacheError(error),
              count: attempt + 1,
              durationMs: now() - retryStartedAt,
            });
          }
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          cancelRegistration = undefined;
        }
      }
    } finally {
      registrationInProgress = false;
    }
  }

  function startLegacyIdbDeletion(): void {
    if (legacyIdbDeletionStarted) return;
    legacyIdbDeletionStarted = true;
    // Cutover cleanup must never delay cache startup or any cache RPC.
    fireAndForget(
      deleteLegacyNormalizedCacheIdb(options.scope),
      'graphql-cache-host'
    );
  }

  function rejectPending(error: Error, transportUncertain = false): void {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
      entry.stopTimeout?.();
      recordRequestOutcome(entry, 'error', error);
      if (
        transportUncertain &&
        entry.admitted &&
        entry.kind === 'enqueue-optimistic-mutation'
      ) {
        entry.reject(
          new CacheResponseError(
            `${error.message}: admitted optimistic enqueue outcome is uncertain`,
            ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
            { cause: error }
          )
        );
      } else {
        entry.reject(error);
      }
    }
  }

  function disposeAdapter(
    graceful: boolean,
    preserveDatabase = false
  ): Promise<void> {
    if (adapterDisposePromise) {
      if (!graceful && adapterDisposeWasGraceful && adapter) {
        adapterDisposeWasGraceful = false;
        try {
          // A pagehide during graceful retirement must reach the adapter so it
          // can terminate immediately without classifying navigation as loss.
          fireAndForget(
            adapter.dispose(
              preserveDatabase
                ? { graceful: false, preserveDatabase: true }
                : { graceful: false }
            ),
            'graphql-cache-host'
          );
        } catch {
          // The original disposal promise still owns final settlement.
        }
      }
      return adapterDisposePromise;
    }
    if (!adapter) return Promise.resolve();
    adapterDisposeWasGraceful = graceful;
    try {
      adapterDisposePromise = adapter
        .dispose(
          preserveDatabase ? { graceful, preserveDatabase: true } : { graceful }
        )
        .catch(() => undefined);
    } catch {
      // The host is already closed and cannot safely retry disposal.
      adapterDisposePromise = Promise.resolve();
    }
    return adapterDisposePromise;
  }

  function clearSubscribers(): void {
    affectedSubscribers.clear();
    cacheChangeSubscribers.clear();
    hydrationSubscribers.clear();
    generationChangeSubscribers.clear();
    settlementSubscribers.clear();
  }

  function reportFailure(error: Error): void {
    if (failureReported) return;
    failureReported = true;
    options.onInitializationError?.(error);
  }

  function failInitialization(
    error: Error,
    stop: { uncertain?: boolean; preserveDatabase?: boolean } = {}
  ): void {
    if (
      state === 'failed' ||
      state === 'suspended' ||
      state === 'disposing' ||
      state === 'disposed' ||
      state === 'ready'
    )
      return;
    telemetry?.record({
      name: 'graphql_cache.host_ready',
      operationCategory: 'initialization',
      outcome: 'error',
      ...describeCacheError(error),
      durationMs:
        initializationStartedAt > 0 ? now() - initializationStartedAt : 0,
    });
    stopForSession(error, stop);
    reportFailure(error);
  }

  /**
   * Fails this host for the rest of the page session: pending requests reject
   * (an admitted enqueue as uncertain when `uncertain`), subscribers are
   * dropped, and the coordinator connection closes.
   */
  function stopForSession(
    error: Error,
    { uncertain = false, preserveDatabase = false } = {}
  ): void {
    state = 'failed';
    releaseTransportWaiters();
    readAvailability.resume();
    initialization = undefined;
    initializationError = error;
    rejectPending(error, uncertain);
    clearSubscribers();
    unregisterPagehide();
    fireAndForget(
      disposeAdapter(false, preserveDatabase).then(finishTelemetry),
      'graphql-cache-host'
    );
  }

  /**
   * Another context, usually a tab on another deployed build, holds the
   * database, and the coordinator touched no storage. Nothing is quarantined:
   * this page stops using the cache until it reloads, and a later page load
   * tries again. A page handing the database to a newer build leaves like a
   * navigating page: its engine stops without counting as a lost owner, and
   * an enqueue already sent may have reached the durable queue, so it is
   * reported uncertain rather than sent again. Once a newer build took the
   * database over (`superseded`), this build never gets it back, so the error
   * says so and recovery does not retry it.
   */
  function retireUnavailable(
    reason: string,
    {
      superseded = false,
      leaveForNewerBuild = false,
      unavailableReason = superseded ? 'superseded' : undefined,
    }: {
      superseded?: boolean;
      leaveForNewerBuild?: boolean;
      unavailableReason?: CacheUnavailableReason;
    } = {}
  ): void {
    if (
      terminalFailureHandled ||
      state === 'failed' ||
      state === 'suspended' ||
      state === 'disposing' ||
      state === 'disposed'
    )
      return;
    terminalFailureHandled = true;
    const error = new CacheUnavailableError(
      reason,
      superseded,
      unavailableReason,
      state === 'initializing' ? 'initialization' : 'operation'
    );
    if (state === 'initializing') {
      telemetry?.record({
        name: 'graphql_cache.host_ready',
        operationCategory: 'initialization',
        outcome: 'error',
        errorCode: superseded ? 'superseded' : 'lock',
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
        durationMs:
          initializationStartedAt > 0 ? now() - initializationStartedAt : 0,
      });
    }
    stopStorageHealthSampling();
    stopForSession(error, {
      uncertain: leaveForNewerBuild,
      preserveDatabase: leaveForNewerBuild,
    });
    reportFailure(error);
  }

  function failTransport(error: Error): void {
    if (terminalFailureHandled || state === 'suspended') return;
    const storageWasUntouched = error instanceof CacheBootstrapExhaustedError;
    stopStorageHealthSampling();
    const admittedWorkIsUncertain = [...pending.values()].some(
      (entry) => entry.admitted
    );
    if (state === 'disposed' && !admittedWorkIsUncertain) return;
    terminalFailureHandled = true;
    stopForSession(error, { uncertain: true });
    // Product failure handling may immediately construct another host. Make
    // the matching old scope unreachable before invoking that callback.
    const quarantine = storageWasUntouched
      ? Promise.resolve()
      : quarantineCacheScope(options.scope);
    fireAndForget(
      quarantine.then(() => {
        try {
          reportFailure(error);
        } catch {
          // Failure reporting cannot reopen or invalidate completed quarantine.
        }
      }),
      'graphql-cache-host'
    );
  }

  function stopStorageHealthSampling(): void {
    if (storageHealthTimer === undefined) return;
    clearIntervalFn(storageHealthTimer);
    storageHealthTimer = undefined;
  }

  function finishTelemetry(): void {
    if (telemetryFinished) return;
    stopStorageHealthSampling();
    telemetryFinished = true;
    telemetry?.flush();
    pageTelemetry?.relay.dispose();
  }

  function startAdapterDisposal(
    graceful: boolean,
    preserveDatabase = false
  ): void {
    if (adapterDisposalStarted) {
      if (!graceful)
        fireAndForget(
          disposeAdapter(false, preserveDatabase),
          'graphql-cache-host'
        );
      return;
    }
    adapterDisposalStarted = true;
    fireAndForget(
      disposeAdapter(graceful, preserveDatabase).then(() => {
        if (state !== 'disposing') return;
        state = 'disposed';
        unregisterPagehide();
        finishTelemetry();
      }),
      'graphql-cache-host'
    );
  }

  function finishGracefulDisposeIfDrained(): void {
    if (
      state !== 'disposing' ||
      disposalMode !== 'draining' ||
      pending.size > 0
    ) {
      return;
    }
    startAdapterDisposal(true);
  }

  /**
   * Stops the host where it is: whatever is pending rejects (an admitted
   * enqueue as uncertain, its queue entry may be stored), and the page leaves
   * the coordinator with the database kept, as a navigating page does.
   */
  function leave(mode: 'leaving' | 'navigation'): void {
    state = 'disposing';
    releaseTransportWaiters();
    disposalMode = mode;
    clearSubscribers();
    rejectPending(
      mode === 'navigation'
        ? new CacheNavigationError()
        : new CacheHostDisposedError(),
      true
    );
    startAdapterDisposal(false, true);
  }

  function disposeForNavigation(): void {
    cancelRegistration?.(new CacheNavigationError());
    stopStorageHealthSampling();
    if (state === 'disposed') return;
    if (state === 'disposing' && disposalMode !== 'draining') return;
    leave('navigation');
  }

  function disposeHost(): void {
    cancelRegistration?.(new CacheHostDisposedError());
    stopStorageHealthSampling();
    if (state === 'disposed' || state === 'disposing') return;
    if (state !== 'ready') {
      leave('leaving');
      return;
    }
    // Stop admission first, but keep the requester/standby connected until
    // every already-admitted RPC has a response or its existing read timer.
    // Mutations deliberately have no arbitrary disposal timeout.
    state = 'disposing';
    disposalMode = 'draining';
    clearSubscribers();
    // Keep pagehide armed through coordinator retirement so navigation can
    // terminate the worker without converting the handoff into a wipe.
    finishGracefulDisposeIfDrained();
  }

  async function finishSuspension(
    startup: Promise<void> | undefined,
    retirement: Promise<void>
  ): Promise<void> {
    // A canceled registration must unwind before a replacement can publish its
    // adapter. Never let the old startup's finally block clear the new one.
    try {
      await startup;
    } catch {
      // Navigation already settled startup callers.
    }
    await retirement;
  }

  function suspendTransport(error: Error): void {
    state = 'suspended';
    readAvailability.resume();
    transportGeneration += 1;
    transportInterruption = error;
    initializationAttempt += 1;
    beginRecoveryGeneration();
    // All active operations need fresh dependencies after reconnect, including
    // reads that never reached the old engine before the connection was lost.
    for (const key of activeOpKeys) lostRegisteredOpKeys.add(key);
    replacementReadOpKeys.clear();
    cancelRegistration?.(error);
    rejectPending(error, true);
    if (adapter) adapter.onmessage = null;
    suspension = finishSuspension(initialization, disposeAdapter(false, true));
    finishTelemetry();
  }

  function reconnectCoordinator(cause: WorkerRestartedError): void {
    if (state === 'failed' || state === 'suspended') return;
    // Typed, so that whoever was waiting on the cut-off startup may build a
    // new host instead of treating the restart as damaged storage.
    const error = new CoordinatorRestartedError({ cause });
    telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'abrupt',
      ownerEvent: 'coordinator-restarted',
      errorCode: 'transport',
    });
    if (state === 'disposing' || state === 'disposed') {
      stopForSession(error, { uncertain: true, preserveDatabase: true });
      return;
    }
    // Bound restarts during startup just like registration retries. A completed
    // handshake resets this budget; separate later restarts can recover again.
    if (++reconnects >= COORDINATOR_CONNECT_ATTEMPTS) {
      stopStorageHealthSampling();
      stopForSession(error, { uncertain: true, preserveDatabase: true });
      reportFailure(error);
      return;
    }
    suspendTransport(error);
    fireAndForget(resumeTransport(), 'graphql-cache-host');
  }

  /**
   * Nobody answered the handshake: a lost connection or message, not a fault in
   * the database. Connects again, as often as a restarted coordinator may.
   */
  function reconnectUnanswered(error: CacheRequestTimeoutError): void {
    if (state !== 'initializing') return;
    telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'error',
      ownerEvent: 'startup-unanswered',
      errorCode: 'timeout',
    });
    if (++reconnects >= COORDINATOR_CONNECT_ATTEMPTS) {
      failInitialization(error, { uncertain: true, preserveDatabase: true });
      return;
    }
    suspendTransport(error);
    fireAndForget(resumeTransport(), 'graphql-cache-host');
  }

  function onPagehide(event: PageTransitionEvent): void {
    if (
      !event.persisted ||
      state === 'failed' ||
      state === 'disposing' ||
      state === 'disposed'
    ) {
      disposeForNavigation();
      return;
    }
    if (state === 'suspended') return;
    suspendTransport(new CacheNavigationError());
  }

  async function resumeTransport(): Promise<void> {
    try {
      // Keep the host and subscribers; only the connection and engine epochs
      // are replaced. Wait for the interrupted startup to unwind first.
      await startInitialization();
    } catch {
      // Initialization failures already invoke the normal product fallback.
    }
  }

  function onPageshow(event: PageTransitionEvent): void {
    if (!event.persisted || state !== 'suspended') return;
    fireAndForget(resumeTransport(), 'graphql-cache-host');
  }

  function navigationError(): CacheNavigationError | undefined {
    if (state === 'suspended' || disposalMode === 'navigation') {
      return new CacheNavigationError();
    }
  }

  const supersededError = () => new Error('cache request was superseded');

  /** Ends this caller's wait on abort; the shared work itself carries on. */
  async function untilAborted<T>(
    work: Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    let onAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(supersededError());
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  function armRequestTimeout(
    id: number,
    entry: Pending,
    timeoutMs: number,
    waiting = false
  ): void {
    entry.stopTimeout?.();
    entry.waiting = waiting;
    const expire = () => {
      if (!pending.delete(id)) return;
      const error = new CacheRequestTimeoutError(entry.kind);
      recordRequestOutcome(entry, 'error', error);
      entry.reject(error);
      if (isInitializationRequest(entry.kind)) reconnectUnanswered(error);
      finishGracefulDisposeIfDrained();
    };
    if (waiting) {
      entry.stopTimeout = visibleTimeout(expire, timeoutMs);
      return;
    }
    const timer = setTimeout(expire, timeoutMs);
    entry.stopTimeout = () => clearTimeout(timer);
  }

  /** Bounds a request as it is admitted. A write has no deadline here. */
  function boundRequest(id: number, entry: Pending): void {
    const waiting = readAvailability.timeoutsPaused;
    if (isReadOnlyCacheRequest(entry.kind))
      armRequestTimeout(id, entry, requestTimeoutMs, waiting);
    else if (isInitializationRequest(entry.kind) && !waiting)
      armRequestTimeout(id, entry, initializationTimeoutMs);
  }

  function request(
    msg: DistributiveOmit<CacheRequest, 'id'>,
    opKey?: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(supersededError());
    if (state === 'failed') {
      return Promise.reject(
        initializationError ?? new Error('cache worker initialization failed')
      );
    }
    const canceled = navigationError();
    if (canceled) return Promise.reject(canceled);
    if (state === 'disposing' || state === 'disposed') {
      return Promise.reject(new CacheHostDisposedError());
    }

    if (isReadOnlyCacheRequest(msg.kind) && readAvailability.error) {
      return Promise.reject(readAvailability.error);
    }
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      // The coordinator may still run its copy; only the caller stops waiting.
      const drop = () => {
        if (!pending.delete(id)) return;
        entry.stopTimeout?.();
        entry.reject(supersededError());
        finishGracefulDisposeIfDrained();
      };
      // One signal serves every replay of a query, so a settled request must
      // not stay reachable from it.
      const forgetSignal = () => signal?.removeEventListener('abort', drop);
      const entry: Pending = {
        authorityGeneration: msg.generation,
        resolve: (value) => {
          forgetSignal();
          resolve(value);
        },
        reject: (error) => {
          forgetSignal();
          reject(error);
        },
        kind: msg.kind,
        typedSearch: isTypedSearch({ ...msg, id }),
        opKey,
        admitted: false,
        waiting: false,
        startedAt: now(),
      };
      boundRequest(id, entry);
      pending.set(id, entry);
      signal?.addEventListener('abort', drop, { once: true });
      try {
        getAdapter().postMessage({ ...msg, id } as CacheRequest);
        // The first accepted coordinator send is the browser Turso host's
        // actual lazy start. Only then begin fire-and-forget legacy cleanup.
        startLegacyIdbDeletion();
        if (pending.has(id)) entry.admitted = true;
      } catch (error) {
        pending.delete(id);
        entry.stopTimeout?.();
        const requestError = asError(error);
        recordRequestOutcome(entry, 'error', requestError);
        entry.reject(requestError);
      }
    });
  }

  async function observeStorageHealth(): Promise<void> {
    try {
      const storage = navigator.storage;
      const [estimate, persisted] = await Promise.all([
        storage.estimate(),
        typeof storage.persisted === 'function'
          ? storage.persisted()
          : Promise.resolve(undefined),
      ]);
      const usageBytes = estimate.usage;
      const quotaBytes = estimate.quota;
      telemetry?.record({
        name: 'graphql_cache.origin_storage_pressure',
        operationCategory: 'storage',
        outcome: 'success',
        persistence:
          persisted === true
            ? 'granted'
            : persisted === false
              ? 'denied'
              : 'unknown',
        usageBytes,
        quotaBytes,
        ratio:
          usageBytes !== undefined && quotaBytes !== undefined && quotaBytes > 0
            ? usageBytes / quotaBytes
            : undefined,
      });
    } catch (error) {
      telemetry?.record({
        name: 'graphql_cache.origin_storage_pressure',
        operationCategory: 'storage',
        outcome: 'error',
        ...describeCacheError(error),
        persistence: 'unknown',
      });
    }
  }

  function startStorageHealthSampling(): void {
    fireAndForget(observeStorageHealth(), 'graphql-cache-host');
    storageHealthTimer ??= setIntervalFn(() => {
      fireAndForget(observeStorageHealth(), 'graphql-cache-host');
    }, storageHealthIntervalMs);
  }

  async function askOwner(attempt: number): Promise<void> {
    await request({
      kind: 'init',
      scope: options.scope,
      hotCapacity: options.hotCapacity,
    });
    if (attempt !== initializationAttempt) throw new CacheNavigationError();
    const version = authorityObserver.version();
    const authority = await request({
      kind: 'current-authority',
      identity: options.scope,
    });
    authorityObserver.observeCurrent(authority, version);
  }

  /** Asks again when the owner is lost: the coordinator keeps it for the next. */
  async function askOwnerUntilAnswered(attempt: number): Promise<void> {
    for (;;) {
      try {
        return await askOwner(attempt);
      } catch (error) {
        if (attempt !== initializationAttempt || state !== 'initializing')
          throw error;
        if (!isOwnerEpochLoss(error)) throw error;
      }
    }
  }

  function startInitialization(): Promise<void> {
    state = 'initializing';
    releaseTransportWaiters();
    replacementError = undefined;
    initializationStartedAt = now();
    const attempt = ++initializationAttempt;
    const suspended = suspension;
    const ready = (async () => {
      if (suspended) {
        await suspended;
        if (attempt !== initializationAttempt) throw new CacheNavigationError();
        if (state !== 'initializing') throw new CacheHostDisposedError();
        suspension = undefined;
        adapter = undefined;
        registeredAdapter = undefined;
        adapterDisposePromise = undefined;
        adapterDisposeWasGraceful = false;
        adapterDisposalStarted = false;
        latestReplacementEpoch = 0;
        initializationTimeoutMs =
          options.initializationTimeoutMs ?? COORDINATOR_CONNECT_TIMEOUT_MS;
        telemetryFinished = false;
        telemetryRelayStarted = false;
        pageTelemetry = options.telemetry
          ? undefined
          : createPageCacheTelemetry({
              rolloutCohort: options.rolloutCohort ?? 'unknown',
              sink: options.telemetrySink,
            });
        telemetry = isolateCacheTelemetry(
          options.telemetry ?? pageTelemetry?.recorder
        );
      }
      if (!adapter || registeredAdapter !== adapter)
        await registerAdapter(attempt);
      if (attempt !== initializationAttempt) throw new CacheNavigationError();
      await askOwnerUntilAnswered(attempt);
    })();
    const handshake = ready.then(
      () => {
        if (attempt !== initializationAttempt || state !== 'initializing')
          return;
        state = 'ready';
        initialization = undefined;
        reconnects = 0;
        if (suspended) {
          // A surviving coordinator need not send engine-replaced to a late
          // joiner. Resets while frozen are unknowable, so conservatively
          // invalidate local checkpoints as well as revision/dependency state.
          emitGenerationChange({ storage: 'reset' });
        }
        telemetry?.record({
          name: 'graphql_cache.host_ready',
          operationCategory: 'initialization',
          outcome: 'success',
          errorCode: 'none',
          durationMs: now() - initializationStartedAt,
        });
        startStorageHealthSampling();
        if (recoveryInProgress) {
          const opKeys = [...lostRegisteredOpKeys].filter(
            (opKey) =>
              activeOpKeys.has(opKey) && !replacementReadOpKeys.has(opKey)
          );
          recoveryInProgress = false;
          lostRegisteredOpKeys.clear();
          replacementReadOpKeys.clear();
          emitAffectedKeys(opKeys);
        }
      },
      (error: unknown) => {
        const initializationFailure = asError(error);
        if (attempt !== initializationAttempt) throw initializationFailure;
        initialization = undefined;
        if (initializationFailure instanceof WorkerRestartedError) {
          // Every registration attempt met a restarted coordinator. No tab
          // registered, so nothing touched storage: end like a restart that
          // ran out of attempts after registering.
          const restarted = new CoordinatorRestartedError({
            cause: initializationFailure,
          });
          failInitialization(restarted, { preserveDatabase: true });
          throw restarted;
        }
        failInitialization(initializationFailure, {
          preserveDatabase:
            initializationFailure instanceof CacheRequestTimeoutError,
        });
        throw initializationFailure;
      }
    );
    initialization = handshake;
    return handshake;
  }

  /** Whether this host still has, or will have, an owner to ask. */
  const isServing = (): boolean =>
    state !== 'failed' && state !== 'disposing' && state !== 'disposed';

  function releaseTransportWaiters(): void {
    const waiters = [...transportWaiters];
    transportWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  /** Waits for the next owner while this host has none, or no connection. */
  function transportReady(): Promise<void> {
    if (state !== 'awaiting-replacement' && state !== 'suspended')
      return Promise.resolve();
    return new Promise((resolve) => transportWaiters.add(resolve));
  }

  function ensureInitialized(): Promise<void> {
    if (state === 'ready') return Promise.resolve();
    if (state === 'initializing' && initialization) return initialization;
    if (state === 'awaiting-replacement') {
      return Promise.reject(
        replacementError ?? new Error('cache worker is awaiting replacement')
      );
    }
    if (state === 'failed') {
      return Promise.reject(
        initializationError ?? new Error('cache worker initialization failed')
      );
    }
    const canceled = navigationError();
    if (canceled) return Promise.reject(canceled);
    if (state === 'disposing' || state === 'disposed') {
      return Promise.reject(new CacheHostDisposedError());
    }
    return startInitialization();
  }

  async function initializedRequest(
    msg: DistributiveOmit<CacheRequest, 'id'>,
    opKey?: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    msg = {
      ...msg,
      // Content keeps the stamp it was fetched under and is never relabelled:
      // only reads and removals take the observed generation.
      generation:
        msg.generation ??
        (cacheRequestStamp(msg.kind) === 'observed'
          ? authorityObserver.snapshot()?.generation
          : undefined) ??
        UNKNOWN_CACHE_GENERATION,
    };
    const generation = transportGeneration;
    const ready =
      state === 'ready'
        ? ensureInitialized()
        : readAvailability.waitUntilReady(
            ensureInitialized,
            isReadOnlyCacheRequest(msg.kind),
            {
              timeoutMs: requestTimeoutMs,
              error: () => new CacheRequestTimeoutError(msg.kind),
            }
          );
    // Every other caller keeps its exact place in line: no extra hop.
    if (signal) await untilAborted(ready, signal);
    else await ready;
    // Never admit an interrupted operation to a different transport generation.
    if (generation !== transportGeneration)
      throw transportInterruption ?? new CacheNavigationError();
    return await request(msg, opKey, signal);
  }

  async function askAuthority(): Promise<CacheAuthority> {
    const version = authorityObserver.version();
    const value = await initializedRequest({
      kind: 'current-authority',
      identity: options.scope,
    });
    return authorityObserver.observeCurrent(value, version);
  }

  /**
   * Answers once there is an owner to ask, however many are lost or however
   * often the page is suspended: a page waits on it to start, and its host says
   * if that ends. Only a ready owner that never answers ends it here.
   */
  async function currentAuthority(): Promise<CacheAuthority> {
    let unanswered = 0;
    for (;;) {
      try {
        return await askAuthority();
      } catch (error) {
        const interrupted =
          isOwnerEpochLoss(error) ||
          error instanceof CacheNavigationError ||
          error instanceof CacheRequestTimeoutError;
        if (!interrupted || !isServing()) throw error;
        if (error instanceof CacheRequestTimeoutError && state === 'ready')
          unanswered += 1;
        if (unanswered === UNANSWERED_AUTHORITY_READS) throw error;
        await transportReady();
      }
    }
  }

  function trackActiveOperation(opKey: number): void {
    activeOpKeys.add(opKey);
    if (state === 'suspended' || readAvailability.error)
      lostRegisteredOpKeys.add(opKey);
    else if (recoveryInProgress) replacementReadOpKeys.add(opKey);
  }

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,
    authority: {
      current: currentAuthority,
      snapshot: authorityObserver.snapshot,
      onChanged: authorityObserver.onChanged,
      transition(expected, policy) {
        return Telemetry.span('crm.access.owner.request', async (span) => {
          await ensureInitialized();
          const version = authorityObserver.version();
          const result = (await initializedRequest({
            kind: 'transition-authority',
            identity: options.scope,
            expected,
            policy,
            traceparent: span.traceparent(),
          })) as AuthorityTransition;
          span.run(() =>
            authorityObserver.observe(result.authority, version, 'transition')
          );
          span.setAttr('crm.access.changed', result.changed);
          return result;
        });
      },
    },
    liveQueries: true,
    people: createPeopleCache({
      snapshot: (request, traceparent) =>
        initializedRequest({ kind: 'contact-snapshot', request, traceparent }),
      reconcile: (request, traceparent, generation) =>
        initializedRequest({
          kind: 'contact-reconcile',
          request,
          traceparent,
          generation,
        }),
      readSql: (request, traceparent) =>
        initializedRequest({ kind: 'people-sql', request, traceparent }),
      resolveReferences: (request, traceparent) =>
        initializedRequest({ kind: 'people-references', request, traceparent }),
      context: (scope, traceparent) =>
        initializedRequest({ kind: 'people-context', scope, traceparent }),
      update: (update, traceparent, generation) =>
        initializedRequest({
          kind: 'people-update',
          update,
          traceparent,
          generation,
        }),
      search: (request, traceparent) =>
        initializedRequest({ kind: 'people-search', request, traceparent }),
    }),

    async currentRevision(): Promise<CacheRevision> {
      return (await initializedRequest({
        kind: 'current-revision',
      })) as CacheRevision;
    },

    async currentStorageGeneration(): Promise<string> {
      return parseStorageGeneration(
        await initializedRequest({ kind: 'current-storage-generation' })
      );
    },

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      if (args.opKey !== undefined) trackActiveOperation(args.opKey);
      return (await initializedRequest(
        {
          kind: 'read',
          opId: args.opKey === undefined ? undefined : opId(args.opKey),
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          priority: args.priority,
          entityResolvers: args.entityResolvers,
        },
        args.opKey
      )) as ReadResult;
    },

    async watchQuery(args): Promise<QueryUpdate> {
      trackActiveOperation(args.opKey);
      return (await initializedRequest(
        {
          kind: 'read',
          opId: opId(args.opKey),
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          priority: args.priority,
          entityResolvers: args.entityResolvers,
          watch: { since: args.since },
        },
        args.opKey
      )) as QueryUpdate;
    },

    async readRecordsByKeys(
      args: ReadRecordsByKeysArgs
    ): Promise<ReadRecordsByKeysResult> {
      const keys = validateRecordSelectionKeys(args.keys);
      return (await initializedRequest({
        kind: 'read-records-by-keys',
        document: args.document,
        fragmentName: args.fragmentName,
        keys,
        ...(args.priority ? { priority: args.priority } : {}),
      })) as ReadRecordsByKeysResult;
    },

    async search(
      args: SearchCacheArgs,
      options?: { signal?: AbortSignal }
    ): Promise<SearchCachePage> {
      const requestArgs = validateCacheSearchArgs(args);
      return (await initializedRequest(
        { kind: 'search', request: requestArgs },
        undefined,
        options?.signal
      )) as SearchCachePage;
    },

    async entityFilter(
      args: EntityFilterCacheArgs
    ): Promise<EntityFilterCacheResult> {
      return (await initializedRequest({
        kind: 'entity-filter',
        request: args,
      })) as EntityFilterCacheResult;
    },

    async calendarRange(
      args: CalendarRangeCacheArgs
    ): Promise<CalendarRangeCacheResult> {
      return (await initializedRequest({
        kind: 'calendar-range',
        request: args,
      })) as CalendarRangeCacheResult;
    },

    async calendarCommit(
      args: CalendarCommitArgs,
      generation: string
    ): Promise<CalendarCommitCacheResult> {
      return (await initializedRequest({
        kind: 'calendar-commit',
        commit: args,
        generation,
      })) as CalendarCommitCacheResult;
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      if (args.registerDependencies && args.opKey !== undefined) {
        trackActiveOperation(args.opKey);
      }
      return (await initializedRequest(
        {
          kind: 'write',
          generation: args.generation,
          originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
          registration:
            args.registerDependencies && args.opKey !== undefined
              ? {
                  opId: opId(args.opKey),
                  entityResolvers: args.entityResolvers,
                }
              : undefined,
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
          identity: args.identity,
        },
        args.registerDependencies ? args.opKey : undefined
      )) as WriteResult;
    },

    async hydrateQuery(args: CacheHydrateArgs): Promise<HydrationResult> {
      return (await initializedRequest({
        kind: 'hydrate',
        generation: args.generation,
        hydrationScope: args.hydrationScope,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      })) as HydrationResult;
    },

    async enqueueOptimisticMutation(
      args: EnqueueOptimisticMutationArgs,
      claim: InitialMutationClaimArgs
    ): Promise<EnqueueOptimisticMutationResult> {
      return (await initializedRequest({
        kind: 'enqueue-optimistic-mutation',
        generation: args.generation,
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        uuid: args.uuid,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        linkPatches: args.linkPatches,
        revalidations: args.revalidations,
        identityBindings: args.identityBindings,
        clientMetadata: args.clientMetadata,
        uncertainCalendarEventKeys: args.uncertainCalendarEventKeys,
        createdAtMs: claim.nowMs,
        owner: claim.owner,
        nowMs: claim.nowMs,
        leaseExpiresAtMs: claim.leaseExpiresAtMs,
      })) as EnqueueOptimisticMutationResult;
    },

    async inspectQueryVariants(
      args: InspectQueryVariantsArgs
    ): Promise<CachedQueryVariantWire[]> {
      return (await initializedRequest({
        kind: 'inspect-query-variants',
        query: args.query,
        operationName: args.operationName,
        path: args.path,
      })) as CachedQueryVariantWire[];
    },

    async inspectQuery(
      args: InspectQueryArgs
    ): Promise<CachedQueryInstanceWire[]> {
      return (await initializedRequest({
        kind: 'inspect-query',
        query: args.query,
        operationName: args.operationName,
        path: args.path,
        variableFilters: args.variableFilters,
      })) as CachedQueryInstanceWire[];
    },

    async inspectMutations() {
      return (await initializedRequest({
        kind: 'inspect-mutations',
      })) as MutationInspection[];
    },
    async claimNextMutation(
      owner: string,
      nowMs: number,
      leaseExpiresAtMs: number
    ): Promise<ClaimedMutation | undefined> {
      return (await initializedRequest({
        kind: 'claim-next-mutation',
        owner,
        nowMs,
        leaseExpiresAtMs,
      })) as ClaimedMutation | undefined;
    },

    async deferOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      nextAttemptAtMs: number,
      error: string,
      serverFailure = false
    ) {
      return (await initializedRequest({
        kind: 'defer-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        nextAttemptAtMs,
        error,
        serverFailure,
      })) as DeferOptimisticWriteResult;
    },

    async commitOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      args: CacheWriteArgs
    ): Promise<CommitOptimisticWriteResult> {
      return (await initializedRequest({
        kind: 'commit-optimistic-write',
        generation: args.generation,
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
      })) as CommitOptimisticWriteResult;
    },

    async rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string,
      errorCode?: string
    ): Promise<RollbackOptimisticWriteResult> {
      return (await initializedRequest({
        kind: 'rollback-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        error,
        ...(errorCode === undefined ? {} : { errorCode }),
      })) as RollbackOptimisticWriteResult;
    },

    async invalidate(keys: string[]): Promise<AffectedOperationsResult> {
      return (await initializedRequest({
        kind: 'invalidate',
        keys,
      })) as AffectedOperationsResult;
    },

    async deleteRecords(
      keys: string[],
      authorityGeneration?: string
    ): Promise<AffectedOperationsResult> {
      return (await initializedRequest({
        kind: 'delete-records',
        keys,
        generation: authorityGeneration,
      })) as AffectedOperationsResult;
    },

    async teardown(opKey: number): Promise<void> {
      activeOpKeys.delete(opKey);
      registeredOpKeys.delete(opKey);
      lostRegisteredOpKeys.delete(opKey);
      replacementReadOpKeys.delete(opKey);
      // urql emits teardown while initialization-failure fallback is
      // unsubscribing operations. Local registration cleanup is sufficient
      // when no usable engine generation remains.
      if (state !== 'ready' && state !== 'initializing') return;
      if (state === 'initializing') {
        try {
          await readAvailability.waitUntilReady(ensureInitialized, false);
        } catch {
          return;
        }
      } else {
        // Match ordinary RPC admission so a same-turn teardown cannot pass a
        // read waiting for the parked coordinator and leave its deps alive.
        await ensureInitialized();
      }
      // Disposal or owner loss can win while an initialization await yields.
      if (state !== 'ready') return;
      await request({ kind: 'teardown', opId: opId(opKey) });
    },

    async clear(): Promise<CacheRevision> {
      const revision = (await initializedRequest({
        kind: 'clear',
      })) as CacheRevision;
      telemetry?.record({
        name: 'graphql_cache.logical_reset',
        operationCategory: 'lifecycle',
        outcome: 'success',
        errorCode: 'none',
        resetReason: 'explicit-clear',
      });
      return revision;
    },

    onOpsAffected(cb: AffectedOperationsListener): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    onCacheChanged(
      cb: CacheChangeListener,
      options?: CacheChangeOptions
    ): () => void {
      cacheChangeSubscribers.add(cb);
      if (options?.includeHydration) hydrationSubscribers.add(cb);
      return () => {
        cacheChangeSubscribers.delete(cb);
        hydrationSubscribers.delete(cb);
      };
    },

    onCacheGenerationChanged(
      cb: (change: CacheGenerationChange) => void
    ): () => void {
      generationChangeSubscribers.add(cb);
      return () => generationChangeSubscribers.delete(cb);
    },

    onMutationSettled(
      cb: (settlement: MutationSettlement) => void
    ): () => void {
      settlementSubscribers.add(cb);
      return () => settlementSubscribers.delete(cb);
    },

    dispose() {
      disposeHost();
    },
  };
}
