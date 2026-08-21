/// <reference lib="webworker" />

import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as FiberSet from 'effect/FiberSet';
import * as Scope from 'effect/Scope';
import { match } from 'ts-pattern';
import type { CacheRequest, CacheResponse } from '../protocol';
import {
  type CacheTelemetryRecorderLike,
  classifyCacheError,
  isolateCacheTelemetry,
} from '../telemetry';
import { workerCacheTelemetry } from '../telemetry-relay';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  type CoordinatorToEngineEnvelope,
  type EngineFatalCode,
  type EngineOpenOutcome,
  type EngineToCoordinatorEnvelope,
  isCachePush,
  isCacheResponse,
  type PageToEngineEnvelope,
  validateCoordinatorToEngineEnvelope,
  validatePageToEngineEnvelope,
} from './coordinator-protocol';
import {
  createEffectWorkerRunnerTransport,
  type EffectWorkerRunnerTransport,
} from './effect-worker-transport';
import { cacheWasmLinearMemoryBytes } from './wasm-module';
import { CacheWorkerCore, type CacheWorkerCoreOptions } from './worker-core';

export type CacheEngineRuntimeEvent =
  | { kind: 'activation-started'; activation: PageToEngineEnvelope }
  | {
      kind: 'request-admitted';
      activation: PageToEngineEnvelope;
      request: CacheRequest;
    }
  | { kind: 'ready'; activation: PageToEngineEnvelope }
  | { kind: 'drained'; activation: PageToEngineEnvelope }
  | {
      kind: 'fatal';
      activation: PageToEngineEnvelope;
      reason: string;
      fatalCode: EngineFatalCode;
    };

export interface CacheEngineRuntimeHooks {
  beforeRequest?: (
    request: CacheRequest,
    activation: PageToEngineEnvelope
  ) => void | Promise<void>;
  onEvent?: (event: CacheEngineRuntimeEvent) => void;
}

interface CacheWorkerCoreLike {
  addPort(port: { postMessage(message: unknown): void }): void;
  handleRequest(
    port: { postMessage(message: unknown): void },
    request: CacheRequest
  ): Promise<void>;
  drain(): Promise<void>;
  recordCachedQueueDiagnostics?(): void;
}

interface DedicatedWorkerScopeLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close(): void;
}

export interface CacheEngineRuntimeOptions {
  scope?: DedicatedWorkerScopeLike;
  hooks?: CacheEngineRuntimeHooks;
  createCore?: (options: CacheWorkerCoreOptions) => CacheWorkerCoreLike;
  ownerLockIsHeld?: (ownerLockName: string) => Promise<boolean>;
  telemetry?: CacheTelemetryRecorderLike;
  /** Injectable clock/memory source for throttling tests. */
  now?: () => number;
  readLinearMemoryBytes?: () => number;
  memoryTelemetryIntervalMs?: number;
}

const withVersion = <T extends { coordinatorVersion: 2 }>(
  value: T extends unknown ? Omit<T, 'coordinatorVersion'> : never
): T =>
  ({
    coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
    ...value,
  }) as unknown as T;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function initializeCore(
  core: CacheWorkerCoreLike,
  activation: PageToEngineEnvelope
): Promise<void> {
  let response: CacheResponse | undefined;
  await core.handleRequest(
    {
      postMessage(message: unknown) {
        if (isCacheResponse(message)) response = message;
      },
    },
    {
      id: 0,
      kind: 'init',
      scope: activation.scope,
      hotCapacity: activation.hotCapacity,
    }
  );
  if (!response || !response.ok) {
    throw new Error(
      response && !response.ok
        ? response.error
        : 'cache engine initialization returned no response'
    );
  }
}

async function defaultOwnerLockIsHeld(ownerLockName: string): Promise<boolean> {
  const snapshot = await navigator.locks.query();
  return Boolean(
    snapshot.held?.some(
      (lock) => lock.name === ownerLockName && lock.mode === 'exclusive'
    )
  );
}

async function activate(
  activation: PageToEngineEnvelope,
  directPort: MessagePort,
  workerScope: DedicatedWorkerScopeLike,
  options: CacheEngineRuntimeOptions
): Promise<void> {
  const hooks = options.hooks;
  const telemetry = isolateCacheTelemetry(
    options.telemetry ?? workerCacheTelemetry()
  );
  const now =
    options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const activationStartedAt = now();
  const readLinearMemoryBytes =
    options.readLinearMemoryBytes ?? cacheWasmLinearMemoryBytes;
  const memoryTelemetryIntervalMs = options.memoryTelemetryIntervalMs ?? 60_000;
  let lastMemoryTelemetryAt = Number.NEGATIVE_INFINITY;
  let linearMemoryHighWaterBytes = 0;
  const recordLinearMemory = (force: boolean): void => {
    const observedAt = now();
    if (
      !force &&
      observedAt - lastMemoryTelemetryAt < memoryTelemetryIntervalMs
    ) {
      return;
    }
    try {
      const bytes = readLinearMemoryBytes();
      linearMemoryHighWaterBytes = Math.max(linearMemoryHighWaterBytes, bytes);
      lastMemoryTelemetryAt = observedAt;
      telemetry.record({
        name: 'graphql_cache.linear_memory',
        operationCategory: 'storage',
        outcome: 'success',
        bytes,
        highWaterBytes: linearMemoryHighWaterBytes,
      });
    } catch {
      // A missing memory export only drops this observation.
    }
  };
  const emitEvent = (event: CacheEngineRuntimeEvent): void => {
    try {
      hooks?.onEvent?.(event);
    } catch {
      // Observation hooks are never part of the ownership protocol.
    }
  };
  emitEvent({ kind: 'activation-started', activation });
  let failed = false;
  let initializationOpenOutcome: EngineOpenOutcome =
    activation.databaseAction === 'wipe-before-open'
      ? 'reset-storage-uncertain'
      : 'opened-existing';
  let draining = false;
  // Keep every admitted handler and graceful drain in one explicit scope.
  // Abrupt owner loss still relies on DedicatedWorker termination; graceful
  // retirement closes this scope only after all admission fibers are empty.
  const lifecycleScope = Effect.runSync(Scope.make());
  const admissions = Effect.runSync(
    Scope.provide(lifecycleScope)(FiberSet.make<void, never>())
  );
  const lifecycleFibers = Effect.runSync(
    Scope.provide(lifecycleScope)(FiberSet.make<void, never>())
  );
  const runAdmission = Effect.runSync(FiberSet.runtime(admissions)());
  const runLifecycle = Effect.runSync(FiberSet.runtime(lifecycleFibers)());
  let closeLifecyclePromise: Promise<void> | undefined;
  const closeLifecycle = (): Promise<void> => {
    closeLifecyclePromise ??= Effect.runPromise(
      Scope.close(lifecycleScope, Exit.void)
    );
    return closeLifecyclePromise;
  };
  let runnerFailed = false;
  let runner!: EffectWorkerRunnerTransport<EngineToCoordinatorEnvelope>;
  const post = (message: EngineToCoordinatorEnvelope): void => {
    try {
      Effect.runSync(runner.send(0, message));
    } catch (error) {
      if (runnerFailed || runner.isClosed()) return;
      throw error;
    }
  };
  const fatal = (
    reason: string,
    fatalCode: EngineFatalCode = 'runtime-failure'
  ): void => {
    if (failed) return;
    failed = true;
    emitEvent({ kind: 'fatal', activation, reason, fatalCode });
    if (runnerFailed) return;
    post(
      withVersion<EngineToCoordinatorEnvelope>({
        kind: 'engine-fatal',
        tabId: activation.tabId,
        ownerEpoch: activation.ownerEpoch,
        reason,
        fatalCode,
      })
    );
  };

  const createCore =
    options.createCore ??
    ((coreOptions: CacheWorkerCoreOptions) => new CacheWorkerCore(coreOptions));
  const core = createCore({
    recoveryOpen: activation.databaseAction === 'wipe-before-open',
    onStorageResetRequired: () => {
      fatal('cache storage requested physical reset', 'storage-reset-required');
    },
    onInitializationOutcome: (outcome) => {
      initializationOpenOutcome = outcome;
    },
    telemetry,
  });
  const enginePort = {
    postMessage(message: unknown): void {
      if (isCacheResponse(message)) {
        if (!message.ok && message.errorCode !== undefined) {
          fatal('CacheWorkerCore emitted a coordinator-only cache error code');
          return;
        }
        post(
          withVersion<EngineToCoordinatorEnvelope>({
            kind: 'engine-response',
            ownerEpoch: activation.ownerEpoch,
            routeId: message.id,
            response: message,
          })
        );
        return;
      }
      if (isCachePush(message)) {
        post(
          withVersion<EngineToCoordinatorEnvelope>({
            kind: 'engine-push',
            ownerEpoch: activation.ownerEpoch,
            push: message,
          })
        );
        return;
      }
      fatal('CacheWorkerCore emitted an invalid cache message');
    },
  };

  const admitRequest = (request: CacheRequest): void => {
    emitEvent({ kind: 'request-admitted', activation, request });
    runAdmission(
      Effect.promise(async () => {
        await hooks?.beforeRequest?.(request, activation);
        if (!failed) await core.handleRequest(enginePort, request);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            fatal(
              `engine request admission failed: ${errorMessage(Cause.squash(cause))}`
            );
          })
        )
      )
    );
  };

  runner = createEffectWorkerRunnerTransport<
    CoordinatorToEngineEnvelope,
    EngineToCoordinatorEnvelope
  >({
    endpoint: directPort,
    onMessage: (_portId, rawMessage) => {
      const parsed = validateCoordinatorToEngineEnvelope(rawMessage);
      if (!parsed.ok) {
        fatal(`invalid coordinator envelope: ${parsed.error}`);
        return;
      }
      const message: CoordinatorToEngineEnvelope = parsed.value;
      if (failed) return;
      if (message.ownerEpoch !== activation.ownerEpoch) {
        fatal('coordinator envelope owner epoch does not match activation');
        return;
      }
      match(message)
        .with({ kind: 'engine-request' }, ({ request }) => {
          if (draining) {
            fatal('coordinator routed a request after drain began');
            return;
          }
          admitRequest(request);
        })
        .with({ kind: 'drain-engine' }, () => {
          if (draining) return;
          draining = true;
          const drainFiber = runLifecycle(
            Effect.gen(function* () {
              yield* FiberSet.awaitEmpty(admissions);
              yield* Effect.promise(() => Promise.resolve(core.drain()));
              recordLinearMemory(true);
              emitEvent({ kind: 'drained', activation });
              telemetry.flush();
              post(
                withVersion<EngineToCoordinatorEnvelope>({
                  kind: 'engine-drained',
                  tabId: activation.tabId,
                  ownerEpoch: activation.ownerEpoch,
                })
              );
              yield* runner.close();
              workerScope.close();
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  fatal(
                    `engine drain failed: ${errorMessage(Cause.squash(cause))}`
                  );
                })
              )
            )
          );
          drainFiber.addObserver(() => {
            void closeLifecycle().catch(() => undefined);
          });
        })
        .with({ kind: 'heartbeat' }, ({ heartbeatId }) => {
          recordLinearMemory(false);
          core.recordCachedQueueDiagnostics?.();
          post(
            withVersion<EngineToCoordinatorEnvelope>({
              kind: 'heartbeat-ack',
              ownerEpoch: activation.ownerEpoch,
              heartbeatId,
            })
          );
        })
        .exhaustive();
    },
    onError: (error) => {
      runnerFailed = true;
      fatal(`coordinator Effect runner failed: ${error.message}`);
    },
  });
  Effect.runSync(
    Scope.addFinalizer(
      lifecycleScope,
      runner.close().pipe(Effect.catchCause(() => Effect.void))
    )
  );

  try {
    await initializeCore(core, activation);
    if (failed) return;
    const ownerLockIsHeld = options.ownerLockIsHeld ?? defaultOwnerLockIsHeld;
    if (!(await ownerLockIsHeld(activation.ownerLockName))) {
      throw new Error('cache engine does not hold its physical owner Web Lock');
    }
    core.addPort(enginePort);
    recordLinearMemory(true);
    post(
      withVersion<EngineToCoordinatorEnvelope>({
        kind: 'engine-ready',
        tabId: activation.tabId,
        ownerEpoch: activation.ownerEpoch,
        ownerLockName: activation.ownerLockName,
        ownerLockHeld: true,
        databaseActionProof: initializationOpenOutcome.startsWith('reset-')
          ? 'wiped-before-open'
          : 'opened-existing',
        openOutcome: initializationOpenOutcome,
      })
    );
    emitEvent({ kind: 'ready', activation });
    telemetry.record({
      name: 'graphql_cache.db_ready',
      operationCategory: 'initialization',
      outcome: 'success',
      errorCode: 'none',
      durationMs: now() - activationStartedAt,
    });
  } catch (error) {
    telemetry.record({
      name: 'graphql_cache.db_ready',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: classifyCacheError(error),
      durationMs: now() - activationStartedAt,
    });
    telemetry.flush();
    post(
      withVersion<EngineToCoordinatorEnvelope>({
        kind: 'activation-failed',
        tabId: activation.tabId,
        ownerEpoch: activation.ownerEpoch,
        reason: errorMessage(error),
        failureCode:
          activation.databaseAction === 'wipe-before-open'
            ? 'recovery-open-failed'
            : 'initialization-failed',
      })
    );
    await closeLifecycle();
  }
}

/** Installs the production dedicated-worker transport around CacheWorkerCore. */
export function installCacheEngineWorker(
  options: CacheEngineRuntimeOptions = {}
): void {
  const workerScope =
    options.scope ?? (self as unknown as DedicatedWorkerScopeLike);
  let activated = false;
  workerScope.onmessage = (event: MessageEvent<unknown>) => {
    const parsed = validatePageToEngineEnvelope(event.data);
    const directPort = event.ports[0];
    if (!parsed.ok || event.ports.length !== 1 || !directPort || activated) {
      for (const port of event.ports) port.close();
      return;
    }
    activated = true;
    void activate(parsed.value, directPort, workerScope, options);
  };
}
