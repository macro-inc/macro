/**
 * Browser CacheHost: routes cache RPC through the SharedWorker coordinator to
 * the currently elected dedicated cache engine. Unsupported browsers receive
 * a storage-free no-op host.
 */

import { deleteLegacyNormalizedCacheIdb } from '../legacy-idb-cleanup';
import {
  ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
  type AffectedOperationsResult,
  type CachedQueryInstanceWire,
  type CachedQueryVariantWire,
  type CacheRequest,
  type CacheResponseErrorCode,
  type CacheRevision,
  type ClaimedMutation,
  type EnqueueOptimisticMutationResult,
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  type HydrationResult,
  isCachePush,
  isCacheResponse,
  type MutationClaim,
  type MutationSettlement,
  OWNER_EPOCH_LOST_ERROR_CODE,
  type ReadRecordsByKeysArgs,
  type ReadRecordsByKeysResult,
  type ReadResult,
  type SearchCacheArgs,
  type SearchCachePage,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
  type WorkerMessage,
  type WriteResult,
} from '../protocol';
import { quarantineCacheScope } from '../scope';
import {
  type CacheRolloutCohort,
  type CacheTelemetryRecorderLike,
  type CacheTelemetrySink,
  classifyCacheError,
  isolateCacheTelemetry,
  operationCategoryForRequest,
} from '../telemetry';
import { createPageCacheTelemetry } from '../telemetry-relay';
import {
  type CacheCoordinatorPageAdapter,
  createCacheCoordinatorPageAdapter,
} from '../worker/coordinator-page-adapter';
import { createNoopCacheHost } from './noop-host';
import type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
  EnqueueOptimisticMutationArgs,
  InitialMutationClaimArgs,
  InspectQueryArgs,
  InspectQueryVariantsArgs,
} from './types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  kind: CacheRequest['kind'];
  opKey?: number;
  admitted: boolean;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
};

type HostState =
  | 'idle'
  | 'initializing'
  | 'awaiting-replacement'
  | 'ready'
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
   * Read-only request timeout in ms (default 10s). A hung worker rejects
   * cache reads; mutating requests remain pending so callers cannot retry an
   * operation that may already have completed durably.
   */
  requestTimeoutMs?: number;
  /**
   * Registration/initialization timeout in ms. Defaults to requestTimeoutMs,
   * so callers cannot hang before a read-only request timer can start.
   */
  initializationTimeoutMs?: number;
  /** Reports terminal initialization or coordinator-transport failure. */
  onInitializationError?: (error: Error) => void;
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
const DEFAULT_STORAGE_HEALTH_INTERVAL_MS = 5 * 60_000;
const MIN_STORAGE_HEALTH_INTERVAL_MS = 1_000;
const MAX_STORAGE_HEALTH_INTERVAL_MS = 15 * 60_000;

function unsupportedBrowserReason(): string | undefined {
  if (typeof SharedWorker !== 'function') {
    return 'SharedWorker is not supported by this browser';
  }
  if (typeof Worker !== 'function') {
    return 'DedicatedWorker is not supported by this browser';
  }
  if (typeof MessageChannel !== 'function') {
    return 'MessageChannel is not supported by this browser';
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.locks ||
    typeof navigator.locks.request !== 'function'
  ) {
    return 'Web Locks are not supported by this browser';
  }
  if (
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    return 'OPFS is not supported by this browser';
  }
  // Do not probe createSyncAccessHandle here: Chromium and Firefox expose it
  // only inside DedicatedWorker. Engine initialization reports that async
  // capability failure through the normal terminal-init path.
  return undefined;
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

class CacheResponseError extends Error {
  constructor(
    message: string,
    readonly errorCode?: CacheResponseErrorCode
  ) {
    super(message);
    this.name = 'CacheResponseError';
  }
}

const isOwnerEpochLoss = (error: unknown): error is CacheResponseError =>
  error instanceof CacheResponseError &&
  error.errorCode === OWNER_EPOCH_LOST_ERROR_CODE;

export function createWorkerCacheHost(options: WorkerHostOptions): CacheHost {
  const pageTelemetry = options.telemetry
    ? undefined
    : createPageCacheTelemetry({
        rolloutCohort: options.rolloutCohort ?? 'unknown',
        sink: options.telemetrySink,
      });
  const telemetry = isolateCacheTelemetry(
    options.telemetry ?? pageTelemetry?.recorder
  );
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  const unsupportedReason = unsupportedBrowserReason();
  if (unsupportedReason) {
    telemetry?.record({
      name: 'graphql_cache.host_ready',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: 'unsupported',
    });
    telemetry?.flush();
    return createNoopCacheHost(unsupportedReason);
  }

  const clientId = crypto.randomUUID();
  const pending = new Map<number, Pending>();
  const activeOpKeys = new Set<number>();
  const registeredOpKeys = new Set<number>();
  const lostRegisteredOpKeys = new Set<number>();
  const replacementReadOpKeys = new Set<number>();
  const affectedSubscribers = new Set<(opKeys: number[]) => void>();
  const cacheChangeSubscribers = new Set<(revision: CacheRevision) => void>();
  const generationChangeSubscribers = new Set<() => void>();
  const settlementSubscribers = new Set<
    (settlement: MutationSettlement) => void
  >();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const initializationTimeoutMs =
    options.initializationTimeoutMs ?? requestTimeoutMs;
  let nextRequestId = 1;
  let state: HostState = 'idle';
  let initialization: Promise<void> | undefined;
  let initializationError: Error | undefined;
  let replacementError: CacheResponseError | undefined;
  let recoveryInProgress = false;
  let latestReplacementEpoch = 0;
  let failureReported = false;
  let terminalFailureHandled = false;
  let adapter: CacheCoordinatorPageAdapter | undefined;
  let adapterDisposePromise: Promise<void> | undefined;
  let adapterDisposeWasGraceful = false;
  let adapterDisposalStarted = false;
  let disposalMode: 'graceful' | 'navigation' | 'abrupt' | undefined;
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

  const onMessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (isCachePush(msg)) {
      if (msg.kind === 'cache-changed') {
        for (const cb of cacheChangeSubscribers) cb(msg.revision);
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
        for (const cb of affectedSubscribers) cb(opKeys);
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
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      recordRequestOutcome(entry, 'error', error);
      entry.reject(error);
      finishGracefulDisposeIfDrained();
      return;
    }
    pending.delete(msg.id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
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

  function onEngineReplaced(ownerEpoch: number): void {
    if (state === 'failed' || state === 'disposing' || state === 'disposed') {
      return;
    }
    if (ownerEpoch <= latestReplacementEpoch) return;
    latestReplacementEpoch = ownerEpoch;
    // Initial readiness completes the already-running first handshake.
    if (state === 'initializing' && !recoveryInProgress) return;
    for (const cb of generationChangeSubscribers) cb();
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

  function observeOwnerEpochLoss(error: CacheResponseError): void {
    if (state === 'failed' || state === 'disposing' || state === 'disposed') {
      return;
    }
    beginRecoveryGeneration();
    // A rejected old-epoch read may have registered dependencies before its
    // response was lost. It belongs to the lost generation, not replacement.
    markPendingRegistrations(lostRegisteredOpKeys);
    replacementError = error;
    initialization = undefined;
    state = 'awaiting-replacement';
  }

  function unregisterPagehide(): void {
    if (!pagehideRegistered || typeof removeEventListener !== 'function') {
      return;
    }
    removeEventListener('pagehide', onPagehide);
    pagehideRegistered = false;
  }

  function registerPagehide(): void {
    if (pagehideRegistered || typeof addEventListener !== 'function') return;
    pagehideRegistered = true;
    addEventListener('pagehide', onPagehide, { once: true });
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
      onEngineReplaced,
      onTerminalError: failTransport,
      telemetry,
    });
    created.onmessage = onMessage;
    adapter = created;
    registerPagehide();
    return created;
  }

  function startLegacyIdbDeletion(): void {
    if (legacyIdbDeletionStarted) return;
    legacyIdbDeletionStarted = true;
    // Cutover cleanup must never delay cache startup or any cache RPC.
    void deleteLegacyNormalizedCacheIdb(options.scope);
  }

  function rejectPending(error: Error, transportUncertain = false): void {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      recordRequestOutcome(entry, 'error', error);
      if (
        transportUncertain &&
        entry.admitted &&
        entry.kind === 'enqueue-optimistic-mutation'
      ) {
        entry.reject(
          new CacheResponseError(
            `${error.message}: admitted optimistic enqueue outcome is uncertain`,
            ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE
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
          void adapter.dispose(
            preserveDatabase
              ? { graceful: false, preserveDatabase: true }
              : { graceful: false }
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
    generationChangeSubscribers.clear();
    settlementSubscribers.clear();
  }

  function reportFailure(error: Error): void {
    if (failureReported) return;
    failureReported = true;
    options.onInitializationError?.(error);
  }

  function failInitialization(error: Error): void {
    if (state === 'failed' || state === 'disposed' || state === 'ready') return;
    telemetry?.record({
      name: 'graphql_cache.host_ready',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: classifyCacheError(error),
      durationMs:
        initializationStartedAt > 0 ? now() - initializationStartedAt : 0,
    });
    state = 'failed';
    initialization = undefined;
    initializationError = error;
    rejectPending(error);
    clearSubscribers();
    unregisterPagehide();
    void disposeAdapter(false).then(finishTelemetry);
    reportFailure(error);
  }

  function hasAdmittedEnqueue(): boolean {
    return [...pending.values()].some(
      (entry) => entry.admitted && entry.kind === 'enqueue-optimistic-mutation'
    );
  }

  function failTransport(error: Error): void {
    if (terminalFailureHandled) return;
    stopStorageHealthSampling();
    const admittedWorkIsUncertain = [...pending.values()].some(
      (entry) => entry.admitted
    );
    if (state === 'disposed' && !admittedWorkIsUncertain) return;
    terminalFailureHandled = true;
    state = 'failed';
    initialization = undefined;
    initializationError = error;
    rejectPending(error, true);
    clearSubscribers();
    unregisterPagehide();
    void disposeAdapter(false).then(finishTelemetry);
    // Product failure handling may immediately construct another host. Make
    // the matching old scope unreachable before invoking that callback.
    void quarantineCacheScope(options.scope).then(() => {
      try {
        reportFailure(error);
      } catch {
        // Failure reporting cannot reopen or invalidate completed quarantine.
      }
    });
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
      if (!graceful) void disposeAdapter(false, preserveDatabase);
      return;
    }
    adapterDisposalStarted = true;
    void disposeAdapter(graceful, preserveDatabase).then(() => {
      if (state !== 'disposing') return;
      state = 'disposed';
      unregisterPagehide();
      finishTelemetry();
    });
  }

  function finishGracefulDisposeIfDrained(): void {
    if (
      state !== 'disposing' ||
      disposalMode !== 'graceful' ||
      pending.size > 0
    ) {
      return;
    }
    startAdapterDisposal(true);
  }

  function disposeHost(graceful: boolean, preserveDatabase = false): void {
    stopStorageHealthSampling();
    if (state === 'disposed') return;
    if (state === 'disposing') {
      if (
        graceful ||
        disposalMode === 'abrupt' ||
        (preserveDatabase && disposalMode === 'navigation')
      ) {
        return;
      }
      if (preserveDatabase) {
        disposalMode = 'navigation';
        clearSubscribers();
        rejectPending(
          new Error('cache worker host was disposed for page navigation'),
          true
        );
        startAdapterDisposal(false, true);
        return;
      }
      disposalMode = 'abrupt';
      const quarantine = hasAdmittedEnqueue();
      clearSubscribers();
      if (quarantine) void quarantineCacheScope(options.scope);
      rejectPending(new Error('cache worker host was abruptly disposed'), true);
      startAdapterDisposal(false);
      return;
    }
    if (graceful && state === 'ready') {
      // Stop admission first, but keep the requester/standby connected until
      // every already-admitted RPC has a response or its existing read timer.
      // Mutations deliberately have no arbitrary disposal timeout.
      state = 'disposing';
      disposalMode = 'graceful';
      clearSubscribers();
      // Keep pagehide armed through coordinator retirement so navigation can
      // terminate the worker without converting the handoff into a wipe.
      finishGracefulDisposeIfDrained();
      return;
    }

    state = 'disposing';
    clearSubscribers();
    if (preserveDatabase) {
      disposalMode = 'navigation';
      rejectPending(
        new Error('cache worker host was disposed for page navigation'),
        true
      );
      startAdapterDisposal(false, true);
      return;
    }

    const quarantine = hasAdmittedEnqueue();
    disposalMode = 'abrupt';
    if (quarantine) void quarantineCacheScope(options.scope);
    rejectPending(new Error('cache worker host was abruptly disposed'), true);
    startAdapterDisposal(false);
  }

  function onPagehide(): void {
    disposeHost(false, true);
  }

  function request(
    msg: DistributiveOmit<CacheRequest, 'id'>,
    opKey?: number
  ): Promise<unknown> {
    if (state === 'failed') {
      return Promise.reject(
        initializationError ?? new Error('cache worker initialization failed')
      );
    }
    if (state === 'disposing' || state === 'disposed') {
      return Promise.reject(new Error('cache worker host was disposed'));
    }

    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        kind: msg.kind,
        opKey,
        admitted: false,
        startedAt: now(),
      };
      const timeoutMs =
        msg.kind === 'init'
          ? initializationTimeoutMs
          : msg.kind === 'current-revision' ||
              msg.kind === 'read' ||
              msg.kind === 'read-records-by-keys' ||
              msg.kind === 'search' ||
              msg.kind === 'entity-filter' ||
              msg.kind === 'inspect-query' ||
              msg.kind === 'inspect-query-variants'
            ? requestTimeoutMs
            : undefined;
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          if (pending.delete(id)) {
            const error = new Error(`cache worker timeout: ${msg.kind}`);
            recordRequestOutcome(entry, 'error', error);
            reject(error);
            finishGracefulDisposeIfDrained();
          }
        }, timeoutMs);
      }
      pending.set(id, entry);
      try {
        getAdapter().postMessage({ ...msg, id } as CacheRequest);
        // The first accepted coordinator send is the browser Turso host's
        // actual lazy start. Only then begin fire-and-forget legacy cleanup.
        startLegacyIdbDeletion();
        if (pending.has(id)) entry.admitted = true;
      } catch (error) {
        if (pending.delete(id) && entry.timer !== undefined) {
          clearTimeout(entry.timer);
        }
        const requestError = asError(error);
        recordRequestOutcome(entry, 'error', requestError);
        reject(requestError);
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
        errorCode: classifyCacheError(error),
        persistence: 'unknown',
      });
    }
  }

  function startStorageHealthSampling(): void {
    void observeStorageHealth();
    storageHealthTimer ??= setIntervalFn(() => {
      void observeStorageHealth();
    }, storageHealthIntervalMs);
  }

  function startInitialization(): Promise<void> {
    state = 'initializing';
    replacementError = undefined;
    initializationStartedAt = now();
    const handshake = request({
      kind: 'init',
      scope: options.scope,
      hotCapacity: options.hotCapacity,
    }).then(
      () => {
        if (state !== 'initializing') return;
        state = 'ready';
        initialization = undefined;
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
        initialization = undefined;
        if (isOwnerEpochLoss(initializationFailure)) {
          observeOwnerEpochLoss(initializationFailure);
        } else {
          failInitialization(initializationFailure);
        }
        throw initializationFailure;
      }
    );
    initialization = handshake;
    return handshake;
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
    if (state === 'disposing' || state === 'disposed') {
      return Promise.reject(new Error('cache worker host was disposed'));
    }
    return startInitialization();
  }

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,

    async currentRevision(): Promise<CacheRevision> {
      await ensureInitialized();
      return (await request({ kind: 'current-revision' })) as CacheRevision;
    },

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      if (args.opKey !== undefined) {
        activeOpKeys.add(args.opKey);
        if (recoveryInProgress) replacementReadOpKeys.add(args.opKey);
      }
      await ensureInitialized();
      return (await request(
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

    async readRecordsByKeys(
      args: ReadRecordsByKeysArgs
    ): Promise<ReadRecordsByKeysResult> {
      const keys = validateRecordSelectionKeys(args.keys);
      await ensureInitialized();
      return (await request({
        kind: 'read-records-by-keys',
        document: args.document,
        fragmentName: args.fragmentName,
        keys,
      })) as ReadRecordsByKeysResult;
    },

    async search(args: SearchCacheArgs): Promise<SearchCachePage> {
      const requestArgs = validateCacheSearchArgs(args);
      await ensureInitialized();
      return (await request({
        kind: 'search',
        request: requestArgs,
      })) as SearchCachePage;
    },

    async entityFilter(
      args: EntityFilterCacheArgs
    ): Promise<EntityFilterCacheResult> {
      await ensureInitialized();
      return (await request({
        kind: 'entity-filter',
        request: args,
      })) as EntityFilterCacheResult;
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      if (args.registerDependencies && args.opKey !== undefined) {
        activeOpKeys.add(args.opKey);
        if (recoveryInProgress) replacementReadOpKeys.add(args.opKey);
      }
      await ensureInitialized();
      return (await request(
        {
          kind: 'write',
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

    async hydrateQuery(
      args: Omit<CacheWriteArgs, 'opKey'>
    ): Promise<HydrationResult> {
      await ensureInitialized();
      return (await request({
        kind: 'hydrate',
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
      await ensureInitialized();
      return (await request({
        kind: 'enqueue-optimistic-mutation',
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        linkPatches: args.linkPatches,
        revalidations: args.revalidations,
        createdAtMs: claim.nowMs,
        owner: claim.owner,
        nowMs: claim.nowMs,
        leaseExpiresAtMs: claim.leaseExpiresAtMs,
      })) as EnqueueOptimisticMutationResult;
    },

    async inspectQueryVariants(
      args: InspectQueryVariantsArgs
    ): Promise<CachedQueryVariantWire[]> {
      await ensureInitialized();
      return (await request({
        kind: 'inspect-query-variants',
        query: args.query,
        operationName: args.operationName,
        path: args.path,
      })) as CachedQueryVariantWire[];
    },

    async inspectQuery(
      args: InspectQueryArgs
    ): Promise<CachedQueryInstanceWire[]> {
      await ensureInitialized();
      return (await request({
        kind: 'inspect-query',
        query: args.query,
        operationName: args.operationName,
        path: args.path,
        variableFilters: args.variableFilters,
      })) as CachedQueryInstanceWire[];
    },

    async claimNextMutation(
      owner: string,
      nowMs: number,
      leaseExpiresAtMs: number
    ): Promise<ClaimedMutation | undefined> {
      await ensureInitialized();
      return (await request({
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
      error: string
    ): Promise<void> {
      await ensureInitialized();
      await request({
        kind: 'defer-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        nextAttemptAtMs,
        error,
      });
    },

    async commitOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      args: CacheWriteArgs
    ): Promise<WriteResult> {
      await ensureInitialized();
      return (await request({
        kind: 'commit-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
      })) as WriteResult;
    },

    async rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string
    ): Promise<WriteResult> {
      await ensureInitialized();
      return (await request({
        kind: 'rollback-optimistic-write',
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        error,
      })) as WriteResult;
    },

    async invalidate(keys: string[]): Promise<AffectedOperationsResult> {
      await ensureInitialized();
      return (await request({
        kind: 'invalidate',
        keys,
      })) as AffectedOperationsResult;
    },

    async deleteRecords(keys: string[]): Promise<AffectedOperationsResult> {
      await ensureInitialized();
      return (await request({
        kind: 'delete-records',
        keys,
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
          await ensureInitialized();
        } catch {
          return;
        }
      }
      // Disposal or owner loss can win while an initialization await yields.
      if (state !== 'ready') return;
      await request({ kind: 'teardown', opId: opId(opKey) });
    },

    async clear(): Promise<CacheRevision> {
      await ensureInitialized();
      const revision = (await request({ kind: 'clear' })) as CacheRevision;
      telemetry?.record({
        name: 'graphql_cache.logical_reset',
        operationCategory: 'lifecycle',
        outcome: 'success',
        errorCode: 'none',
        resetReason: 'explicit-clear',
      });
      return revision;
    },

    onOpsAffected(cb: (opKeys: number[]) => void): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    onCacheChanged(cb: (revision: CacheRevision) => void): () => void {
      cacheChangeSubscribers.add(cb);
      return () => cacheChangeSubscribers.delete(cb);
    },

    onCacheGenerationChanged(cb: () => void): () => void {
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
      disposeHost(true);
    },
  };
}
