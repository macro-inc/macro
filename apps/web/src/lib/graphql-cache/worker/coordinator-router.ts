import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import { match } from 'ts-pattern';
import type { CacheResponse } from '../protocol';
import {
  type CacheResetReason,
  type CacheTelemetryRecorderLike,
  classifyCacheError,
  isolateCacheTelemetry,
  NOOP_CACHE_TELEMETRY,
  operationCategoryForRequest,
} from '../telemetry';
import { workerCacheTelemetry } from '../telemetry-relay';
import {
  type CoordinatorAction,
  CoordinatorCore,
  type CoordinatorSnapshot,
  startupPhaseMayTouchStorage,
} from './coordinator-core';
import {
  type ActivationFailureCode,
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  type CoordinatorToEngineEnvelope,
  type CoordinatorToTabEnvelope,
  databaseOwnerLockName,
  type EngineFatalCode,
  type EngineOpenOutcome,
  type EngineToCoordinatorEnvelope,
  type TabToCoordinatorEnvelope,
  tabIdFromLivenessLockName,
  tabLivenessLockName,
  validateEngineToCoordinatorEnvelope,
  validateTabToCoordinatorEnvelope,
} from './coordinator-protocol';
import {
  createEffectWorkerTransport,
  type EffectWorkerTransport,
} from './effect-worker-transport';
import {
  ENGINE_ASSET_LOAD_TIMEOUT_MS,
  ENGINE_DATABASE_OPEN_TIMEOUT_MS,
  OWNER_LOCK_OTHER_BUILD_GRACE_MS,
  OWNER_LOCK_WAIT_TIMEOUT_MS,
} from './startup';

export interface CoordinatorMessagePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfers?: Transferable[]): void;
  close(): void;
  start(): void;
}

export type CancelLivenessWatch = () => void;

export interface CoordinatorRouterOptions {
  assetLoadTimeoutMs?: number;
  ownerLockWaitTimeoutMs?: number;
  otherBuildGraceMs?: number;
  activationTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  verifyTabLockHeld?: (lockName: string) => Promise<boolean>;
  verifyOwnerLockHeld?: (lockName: string) => Promise<boolean>;
  /** Names of every Web Lock currently held in this storage partition. */
  queryHeldLockNames?: () => Promise<string[]>;
  watchTabLock?: (
    lockName: string,
    onReleased: () => void
  ) => CancelLivenessWatch;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  queueMicrotask?: typeof globalThis.queueMicrotask;
  telemetry?: CacheTelemetryRecorderLike;
}

type TabConnection = {
  port: CoordinatorMessagePort;
  cancelLivenessWatch: CancelLivenessWatch;
};

type PendingRegistration = { cancelled: boolean; tabId: string };

type EngineRoute = {
  tabId: string;
  ownerEpoch: number;
  transport: EffectWorkerTransport<CoordinatorToEngineEnvelope>;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5_000;
const RECOVERY_RETRY_LIMIT = 5;
const RECOVERY_RETRY_BASE_DELAY_MS = 100;

const recoveryRetryDelayMs = (failureCount: number): number =>
  Effect.runSync(
    Effect.gen(function* () {
      const step = yield* Schedule.toStep(
        Schedule.exponential(Duration.millis(RECOVERY_RETRY_BASE_DELAY_MS))
      );
      let delay = Duration.zero;
      for (let index = 0; index < failureCount; index += 1) {
        [, delay] = yield* step(index, undefined);
      }
      return Duration.toMillis(delay);
    })
  );

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const resetReasonForOpenOutcome = (
  outcome: EngineOpenOutcome
): CacheResetReason => {
  switch (outcome) {
    case 'reset-incompatible':
      return 'namespace-mismatch';
    case 'reset-corrupt':
      return 'integrity-failure';
    case 'reset-storage-uncertain':
      return 'storage-reset-required';
    case 'opened-existing':
    case 'opened-new':
      return 'unknown';
  }
};

type WithoutVersion<T> = T extends unknown
  ? Omit<T, 'coordinatorVersion'>
  : never;

const envelope = <T extends { coordinatorVersion: 6 }>(
  value: WithoutVersion<T>
): T =>
  ({
    coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
    ...value,
  }) as unknown as T;

/** Probes lock ownership without queuing behind or stealing the held lock. */
export async function verifyExclusiveLockHeld(
  lockName: string
): Promise<boolean> {
  return await navigator.locks.request(
    lockName,
    { mode: 'exclusive', ifAvailable: true },
    (lock) => lock === null
  );
}

export async function queryHeldLockNames(): Promise<string[]> {
  const snapshot = await navigator.locks.query();
  return (snapshot.held ?? []).flatMap((lock) =>
    lock.name === undefined ? [] : [lock.name]
  );
}

/** Waits for the page's liveness lock to be released or abandoned. */
export function watchTabLivenessLock(
  lockName: string,
  onReleased: () => void
): CancelLivenessWatch {
  const abortController = new AbortController();
  void navigator.locks
    .request(
      lockName,
      { mode: 'exclusive', signal: abortController.signal },
      (lock) => {
        if (lock) onReleased();
      }
    )
    .catch((error: unknown) => {
      if (
        !abortController.signal.aborted &&
        (!(error instanceof DOMException) || error.name !== 'AbortError')
      ) {
        console.error('[graphql-cache] tab liveness watch failed');
      }
    });
  return () => abortController.abort();
}

/** SharedWorker adapter around the deterministic coordinator state machine. */
export class CoordinatorRouter {
  private coreValue: CoordinatorCore | undefined;
  private hotCapacity: number | undefined;
  private readonly tabs = new Map<string, TabConnection>();
  private readonly portTabs = new Map<CoordinatorMessagePort, string>();
  private readonly pendingRegistrations = new Map<
    CoordinatorMessagePort,
    PendingRegistration
  >();
  private engineRoute: EngineRoute | undefined;
  private activationTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatIntervalTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private nextHeartbeatId = 1;
  private pendingHeartbeat:
    | { ownerEpoch: number; heartbeatId: number }
    | undefined;

  private readonly assetLoadTimeoutMs: number;
  private readonly ownerLockWaitTimeoutMs: number;
  private readonly otherBuildGraceMs: number;
  private readonly activationTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly verifyTabLockHeld: (lockName: string) => Promise<boolean>;
  private readonly verifyOwnerLockHeld: (lockName: string) => Promise<boolean>;
  private readonly queryHeldLockNames: () => Promise<string[]>;
  private readonly watchTabLock: (
    lockName: string,
    onReleased: () => void
  ) => CancelLivenessWatch;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;
  private readonly queueMicrotaskFn: typeof globalThis.queueMicrotask;
  private readonly telemetry: CacheTelemetryRecorderLike;
  private readonly routeStarted = new Map<
    number,
    {
      startedAt: number;
      ownerEpoch: number;
      category: ReturnType<typeof operationCategoryForRequest>;
    }
  >();
  private readonly activationStarted = new Map<number, number>();
  private readonly pendingRecoveryResetEpochs = new Map<
    number,
    CacheResetReason
  >();
  private nextRecoveryResetReason: CacheResetReason | undefined;
  private readonly resetRequiredEpochs = new Set<number>();
  private recoveryAttemptCount = 0;
  private recoveryRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now = (): number =>
    globalThis.performance?.now() ?? Date.now();

  constructor(options: CoordinatorRouterOptions = {}) {
    this.assetLoadTimeoutMs =
      options.assetLoadTimeoutMs ?? ENGINE_ASSET_LOAD_TIMEOUT_MS;
    this.ownerLockWaitTimeoutMs =
      options.ownerLockWaitTimeoutMs ?? OWNER_LOCK_WAIT_TIMEOUT_MS;
    this.otherBuildGraceMs =
      options.otherBuildGraceMs ?? OWNER_LOCK_OTHER_BUILD_GRACE_MS;
    this.activationTimeoutMs =
      options.activationTimeoutMs ?? ENGINE_DATABASE_OPEN_TIMEOUT_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.verifyTabLockHeld =
      options.verifyTabLockHeld ?? verifyExclusiveLockHeld;
    this.verifyOwnerLockHeld =
      options.verifyOwnerLockHeld ?? verifyExclusiveLockHeld;
    this.queryHeldLockNames = options.queryHeldLockNames ?? queryHeldLockNames;
    this.watchTabLock = options.watchTabLock ?? watchTabLivenessLock;
    this.setTimeoutFn =
      options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.queueMicrotaskFn =
      options.queueMicrotask ?? globalThis.queueMicrotask.bind(globalThis);
    this.telemetry = isolateCacheTelemetry(
      options.telemetry ??
        (typeof window === 'undefined'
          ? workerCacheTelemetry()
          : NOOP_CACHE_TELEMETRY)
    );
  }

  get core(): CoordinatorCore | undefined {
    return this.coreValue;
  }

  snapshot(): CoordinatorSnapshot | undefined {
    return this.coreValue?.snapshot();
  }

  connect(port: CoordinatorMessagePort): void {
    port.onmessage = (event: MessageEvent<unknown>) => {
      void this.handleTabMessage(port, event.data, event.ports);
    };
    port.onmessageerror = () => {
      const tabId = this.portTabs.get(port);
      if (tabId) {
        this.loseTab(tabId, 'tab MessagePort messageerror');
        return;
      }
      const registration = this.pendingRegistrations.get(port);
      if (registration) {
        registration.cancelled = true;
        if (this.pendingRegistrations.get(port) === registration) {
          this.pendingRegistrations.delete(port);
        }
      }
      port.close();
    };
    port.start();
  }

  async handleTabMessage(
    port: CoordinatorMessagePort,
    rawMessage: unknown,
    transferredPorts: readonly MessagePort[] = []
  ): Promise<void> {
    const parsed = validateTabToCoordinatorEnvelope(rawMessage);
    if (!parsed.ok) {
      this.postProtocolError(port, parsed.error);
      return;
    }
    const message = parsed.value;
    if (transferredPorts.length !== 0) {
      for (const transferredPort of transferredPorts) transferredPort.close();
      this.postProtocolError(
        port,
        'coordinator envelope transferred unexpected event ports'
      );
      return;
    }
    if (message.kind === 'register-tab') {
      await this.register(port, message);
      return;
    }

    const tabId = this.portTabs.get(port);
    if (!tabId) {
      this.postProtocolError(port, 'message arrived before tab registration');
      return;
    }
    if (message.tabId !== tabId) {
      this.postProtocolError(
        port,
        'message tab id does not match the registered port'
      );
      return;
    }
    const core = this.coreValue;
    if (!core) {
      this.postProtocolError(port, 'coordinator is not initialized');
      return;
    }

    match(message)
      .with({ kind: 'cache-request' }, ({ request }) => {
        this.applyActions(core.request(tabId, request));
      })
      .with({ kind: 'attach-engine-port' }, ({ ownerEpoch, enginePort }) => {
        this.attachEnginePort(tabId, ownerEpoch, enginePort);
      })
      .with({ kind: 'graceful-departure' }, ({ ownerEpoch }) => {
        this.applyActions(core.beginGracefulDeparture(tabId, ownerEpoch));
      })
      .with({ kind: 'navigation-departure' }, ({ ownerEpoch, reason }) => {
        this.departForNavigation(tabId, ownerEpoch, reason);
      })
      .with({ kind: 'engine-lost' }, ({ ownerEpoch, reason }) => {
        this.failOwner(tabId, ownerEpoch, reason);
      })
      .with({ kind: 'disconnect-tab' }, ({ reason }) => {
        this.loseTab(tabId, reason);
      })
      .exhaustive();
  }

  private async register(
    port: CoordinatorMessagePort,
    message: Extract<TabToCoordinatorEnvelope, { kind: 'register-tab' }>
  ): Promise<void> {
    if (this.portTabs.has(port) || this.pendingRegistrations.has(port)) {
      this.postProtocolError(port, 'MessagePort already registered');
      return;
    }
    if (this.tabs.has(message.tabId)) {
      this.postProtocolError(port, 'tab id is already registered');
      port.close();
      return;
    }
    const expectedLockName = tabLivenessLockName(message.scope, message.tabId);
    if (message.livenessLockName !== expectedLockName) {
      this.postProtocolError(
        port,
        'tab registered without the expected liveness-lock name'
      );
      port.close();
      return;
    }
    if (this.coreValue && this.coreValue.scope !== message.scope) {
      this.postProtocolError(port, 'coordinator scope mismatch');
      port.close();
      return;
    }
    if (this.coreValue && this.hotCapacity !== message.hotCapacity) {
      this.postProtocolError(port, 'coordinator hot-capacity mismatch');
      port.close();
      return;
    }

    const registration: PendingRegistration = {
      cancelled: false,
      tabId: message.tabId,
    };
    this.pendingRegistrations.set(port, registration);
    let lockHeld = false;
    try {
      lockHeld = await this.verifyTabLockHeld(message.livenessLockName);
    } catch {
      if (
        registration.cancelled ||
        this.pendingRegistrations.get(port) !== registration
      ) {
        return;
      }
      this.pendingRegistrations.delete(port);
      this.postProtocolError(port, 'tab liveness-lock verification failed');
      port.close();
      return;
    }
    if (
      registration.cancelled ||
      this.pendingRegistrations.get(port) !== registration
    ) {
      return;
    }
    this.pendingRegistrations.delete(port);
    if (!lockHeld) {
      this.postProtocolError(
        port,
        'tab registration requires an already-held liveness lock'
      );
      port.close();
      return;
    }
    // Recheck after the asynchronous lock probe so concurrent registrations
    // cannot race a duplicate tab or mismatched first scope into the router.
    if (this.portTabs.has(port) || this.tabs.has(message.tabId)) {
      this.postProtocolError(port, 'tab registration raced another port');
      port.close();
      return;
    }
    if (
      this.coreValue &&
      (this.coreValue.scope !== message.scope ||
        this.hotCapacity !== message.hotCapacity)
    ) {
      this.postProtocolError(port, 'coordinator registration raced a mismatch');
      port.close();
      return;
    }

    if (!this.coreValue) {
      this.coreValue = new CoordinatorCore(message.scope);
      this.hotCapacity = message.hotCapacity;
    }
    let connection: TabConnection;
    const cancelLivenessWatch = this.watchTabLock(
      message.livenessLockName,
      () => {
        const current = this.tabs.get(message.tabId);
        if (current && current === connection) {
          this.loseTab(message.tabId, 'tab liveness lock was released');
        }
      }
    );
    connection = { port, cancelLivenessWatch };
    this.tabs.set(message.tabId, connection);
    this.portTabs.set(port, message.tabId);
    this.postToTab(
      message.tabId,
      envelope<CoordinatorToTabEnvelope>({
        kind: 'registered',
        tabId: message.tabId,
      })
    );
    const actions = this.coreValue.registerTab(message.tabId);
    this.applyActions(actions);
    // Late joiners must use the same startup budget as the elected owner.
    if (!actions.some((action) => action.kind === 'elect-owner')) {
      const progress = this.startupProgress();
      if (progress) this.postToTab(message.tabId, progress);
    }
  }

  private attachEnginePort(
    tabId: string,
    ownerEpoch: number,
    transferredPort: MessagePort | undefined
  ): void {
    const core = this.coreValue;
    if (
      !core?.expectsEngine(tabId, ownerEpoch) ||
      !transferredPort ||
      this.engineRoute
    ) {
      transferredPort?.close();
      if (core?.expectsEngine(tabId, ownerEpoch)) {
        this.failOwner(tabId, ownerEpoch, 'invalid direct engine attachment');
      } else {
        this.postProtocolError(
          this.tabs.get(tabId)?.port,
          `stale engine port for epoch ${ownerEpoch}`
        );
      }
      return;
    }

    let route: EngineRoute | undefined;
    let transport: EffectWorkerTransport<CoordinatorToEngineEnvelope>;
    try {
      transport = createEffectWorkerTransport<
        EngineToCoordinatorEnvelope,
        CoordinatorToEngineEnvelope
      >({
        endpoint: transferredPort,
        onMessage: (message) => {
          if (route && this.engineRoute === route) {
            this.handleEngineMessage(route, message);
          }
        },
        onError: (error) => {
          if (route && this.engineRoute === route) {
            this.failOwner(
              tabId,
              ownerEpoch,
              `engine Effect transport failed: ${error.message}`
            );
          }
        },
        closeEndpoint: () => transferredPort.close(),
      });
    } catch (error) {
      transferredPort.close();
      this.failOwner(
        tabId,
        ownerEpoch,
        `engine Effect transport failed: ${errorMessage(error)}`
      );
      return;
    }
    route = { tabId, ownerEpoch, transport };
    this.engineRoute = route;
    void transport.ready.catch(() => undefined);
  }

  private handleEngineMessage(route: EngineRoute, rawMessage: unknown): void {
    const parsed = validateEngineToCoordinatorEnvelope(rawMessage);
    if (!parsed.ok) {
      this.failOwner(
        route.tabId,
        route.ownerEpoch,
        `invalid engine envelope: ${parsed.error}`
      );
      return;
    }
    const message = parsed.value;
    const core = this.coreValue;
    if (!core) return;
    if (
      message.ownerEpoch !== route.ownerEpoch ||
      ('tabId' in message && message.tabId !== route.tabId)
    ) {
      this.failOwner(
        route.tabId,
        route.ownerEpoch,
        'engine envelope owner tuple does not match its direct route'
      );
      return;
    }

    switch (message.kind) {
      case 'engine-assets-ready': {
        // The engine now tries to take the owner lock without touching
        // storage, and gives up by itself if another context keeps it.
        if (!core.beginOwnerLockWait(message.tabId, message.ownerEpoch)) {
          this.failOwner(
            message.tabId,
            message.ownerEpoch,
            'unexpected engine asset readiness'
          );
          break;
        }
        this.armStartupWatchdog(message.tabId, message.ownerEpoch);
        break;
      }
      case 'owner-lock-acquired': {
        if (!core.beginEngineOpen(message.tabId, message.ownerEpoch)) {
          this.failOwner(
            message.tabId,
            message.ownerEpoch,
            'unexpected owner lock acquisition'
          );
          break;
        }
        this.armStartupWatchdog(message.tabId, message.ownerEpoch);
        this.sendToEngine(
          route,
          envelope<CoordinatorToEngineEnvelope>({
            kind: 'open-engine',
            ownerEpoch: message.ownerEpoch,
          })
        );
        break;
      }
      case 'owner-lock-busy':
        void this.checkBusyOwnerLock(route, message.elapsedMs);
        break;
      case 'owner-lock-unavailable':
        this.closeUnavailable(
          route.tabId,
          route.ownerEpoch,
          'the engine stopped retrying'
        );
        break;
      case 'engine-ready': {
        const actions = core.engineReady({
          ...message,
          expectedOwnerLockName: databaseOwnerLockName(core.scope),
        });
        const violated = actions.some(
          (action) => action.kind === 'protocol-violation'
        );
        this.applyActions(actions);
        if (violated) {
          if (this.isCurrentOwner(route.tabId, route.ownerEpoch)) {
            this.failOwner(
              route.tabId,
              route.ownerEpoch,
              'engine readiness proof was rejected'
            );
          } else {
            this.postTerminateEngine(
              route.tabId,
              route.ownerEpoch,
              'engine readiness proof was rejected'
            );
          }
          break;
        }
        if (
          core.state.kind === 'active' &&
          core.state.ownerEpoch === message.ownerEpoch
        ) {
          const recoveryResetReason = this.pendingRecoveryResetEpochs.get(
            message.ownerEpoch
          );
          if (recoveryResetReason !== undefined) {
            this.pendingRecoveryResetEpochs.delete(message.ownerEpoch);
            this.recordLogicalResetAndWipe(
              recoveryResetReason,
              message.openOutcome
            );
          } else if (message.openOutcome.startsWith('reset-')) {
            const resetReason = resetReasonForOpenOutcome(message.openOutcome);
            this.recordStorageResetRequired(
              message.ownerEpoch,
              resetReason,
              message.openOutcome
            );
            this.recordLogicalResetAndWipe(
              resetReason,
              message.openOutcome,
              false
            );
          }
          const startedAt = this.activationStarted.get(message.ownerEpoch);
          this.activationStarted.delete(message.ownerEpoch);
          this.telemetry.record({
            name: 'graphql_cache.owner',
            operationCategory: 'lifecycle',
            outcome: 'success',
            ownerEvent: 'activated',
            durationMs:
              startedAt === undefined ? undefined : this.now() - startedAt,
          });
          this.clearActivationTimer();
          this.resetRecoveryRetries();
          this.scheduleHeartbeat(message.ownerEpoch);
          void this.allowStaleDatabaseRemoval(route);
        }
        break;
      }
      case 'engine-response': {
        const timing = this.routeStarted.get(message.routeId);
        this.routeStarted.delete(message.routeId);
        if (timing) {
          this.telemetry.record({
            name: 'graphql_cache.coordinator_request',
            operationCategory: timing.category,
            outcome: message.response.ok ? 'success' : 'error',
            errorCode: message.response.ok
              ? 'none'
              : classifyCacheError(message.response.error),
            durationMs: this.now() - timing.startedAt,
          });
        }
        this.applyActions(
          core.engineResponse(
            message.ownerEpoch,
            message.routeId,
            message.response
          )
        );
        break;
      }
      case 'engine-push':
        this.applyActions(core.enginePush(message.ownerEpoch, message.push));
        break;
      case 'engine-drained': {
        const actions = core.engineDrained(message.tabId, message.ownerEpoch);
        if (actions.some((action) => action.kind === 'protocol-violation')) {
          this.applyActions(actions);
          this.failOwner(
            route.tabId,
            route.ownerEpoch,
            'unexpected engine-drained from current direct route'
          );
          break;
        }
        this.telemetry.record({
          name: 'graphql_cache.owner',
          operationCategory: 'lifecycle',
          outcome: 'graceful',
          ownerEvent: 'graceful-drain-completed',
        });
        this.applyActions(actions);
        break;
      }
      case 'engine-fatal':
        this.failOwner(
          message.tabId,
          message.ownerEpoch,
          message.reason,
          message.fatalCode
        );
        break;
      case 'activation-failed':
        if (message.failureCode === 'storage-busy') {
          this.closeUnavailable(
            route.tabId,
            route.ownerEpoch,
            message.reason,
            'storage-busy'
          );
          break;
        }
        this.failOwner(
          message.tabId,
          message.ownerEpoch,
          message.reason,
          undefined,
          message.failureCode
        );
        break;
      case 'heartbeat-ack':
        this.acceptHeartbeat(message.ownerEpoch, message.heartbeatId);
        break;
    }
  }

  private applyActions(actions: CoordinatorAction[]): void {
    const core = this.coreValue;
    if (!core) return;
    for (const action of actions) {
      switch (action.kind) {
        case 'elect-owner':
          this.clearEngineWatchdogs();
          this.activationStarted.set(action.ownerEpoch, this.now());
          this.telemetry.record({
            name: 'graphql_cache.owner',
            operationCategory: 'lifecycle',
            outcome: 'success',
            ownerEvent: 'elected',
          });
          if (action.databaseAction === 'wipe-before-open') {
            this.pendingRecoveryResetEpochs.set(
              action.ownerEpoch,
              this.nextRecoveryResetReason ?? 'abrupt-owner-loss'
            );
            this.nextRecoveryResetReason = undefined;
          }
          this.armStartupWatchdog(action.tabId, action.ownerEpoch);
          this.postToTab(
            action.tabId,
            envelope<CoordinatorToTabEnvelope>({
              kind: 'become-owner',
              scope: core.scope,
              tabId: action.tabId,
              ownerEpoch: action.ownerEpoch,
              databaseAction: action.databaseAction,
              ownerLockName: databaseOwnerLockName(core.scope),
              hotCapacity: this.hotCapacity,
            })
          );
          break;
        case 'route-request': {
          this.routeStarted.set(action.routeId, {
            startedAt: this.now(),
            ownerEpoch: action.ownerEpoch,
            category: operationCategoryForRequest(action.request),
          });
          const route = this.engineRoute;
          if (
            !route ||
            route.tabId !== action.ownerTabId ||
            route.ownerEpoch !== action.ownerEpoch
          ) {
            this.failOwner(
              action.ownerTabId,
              action.ownerEpoch,
              'direct engine MessagePort is missing'
            );
            break;
          }
          this.sendToEngine(
            route,
            envelope<CoordinatorToEngineEnvelope>({
              kind: 'engine-request',
              ownerEpoch: action.ownerEpoch,
              routeId: action.routeId,
              request: action.request,
            })
          );
          break;
        }
        case 'deliver-response':
          this.postCacheResponse(action.tabId, action.response);
          break;
        case 'broadcast-push':
          this.broadcast(
            envelope<CoordinatorToTabEnvelope>({
              kind: 'cache-message',
              message: action.push,
            })
          );
          break;
        case 'reject-request':
          this.postCacheResponse(action.tabId, {
            id: action.requestId,
            ok: false,
            error: action.error,
            ...(action.errorCode === undefined
              ? {}
              : { errorCode: action.errorCode }),
          });
          break;
        case 'drain-owner': {
          this.telemetry.record({
            name: 'graphql_cache.owner',
            operationCategory: 'lifecycle',
            outcome: 'graceful',
            ownerEvent: 'graceful-drain-started',
          });
          this.clearHeartbeatTimers();
          const route = this.engineRoute;
          if (
            !route ||
            route.tabId !== action.tabId ||
            route.ownerEpoch !== action.ownerEpoch
          ) {
            this.failOwner(
              action.tabId,
              action.ownerEpoch,
              'direct engine MessagePort disappeared before drain'
            );
            break;
          }
          this.sendToEngine(
            route,
            envelope<CoordinatorToEngineEnvelope>({
              kind: 'drain-engine',
              ownerEpoch: action.ownerEpoch,
            })
          );
          break;
        }
        case 'close-engine-route':
          this.clearEngineWatchdogs();
          if (
            this.engineRoute?.tabId === action.tabId &&
            this.engineRoute.ownerEpoch === action.ownerEpoch
          ) {
            const route = this.engineRoute;
            this.engineRoute = undefined;
            void Effect.runPromise(route.transport.close()).catch(
              () => undefined
            );
          }
          break;
        case 'drop-tab':
          this.removeTabConnection(action.tabId);
          break;
        case 'retire-tab':
          this.postToTab(
            action.tabId,
            envelope<CoordinatorToTabEnvelope>({
              kind: 'retire-complete',
              tabId: action.tabId,
              ownerEpoch: action.ownerEpoch,
            })
          );
          this.removeTabConnection(action.tabId);
          break;
        case 'schedule-reset-activation':
          this.scheduleResetActivation();
          break;
        case 'broadcast-cache-unavailable':
          this.broadcast(
            envelope<CoordinatorToTabEnvelope>({
              kind: 'cache-unavailable',
              reason: action.reason,
            })
          );
          break;
        case 'broadcast-engine-replaced':
          this.telemetry.record({
            name: 'graphql_cache.owner',
            operationCategory: 'lifecycle',
            outcome: 'success',
            ownerEvent: 'replacement',
          });
          this.broadcast(
            envelope<CoordinatorToTabEnvelope>({
              kind: 'engine-replaced',
              ownerEpoch: action.ownerEpoch,
              openOutcome: action.openOutcome,
            })
          );
          break;
        case 'drop-stale-engine-message':
          this.telemetry.record({
            name: 'graphql_cache.stale_drop',
            operationCategory: 'lifecycle',
            outcome: 'success',
            errorCode: 'owner-lost',
            count: 1,
          });
          break;
        case 'protocol-violation':
          this.telemetry.record({
            name: 'graphql_cache.owner',
            operationCategory: 'lifecycle',
            outcome: 'error',
            ownerEvent:
              action.error.includes('already owns') ||
              action.error.includes('multiple owner')
                ? 'multiple-owner-detected'
                : undefined,
            errorCode: 'protocol',
          });
          this.broadcast(
            envelope<CoordinatorToTabEnvelope>({
              kind: 'protocol-error',
              error: action.error,
            })
          );
          break;
        case 'terminal-failure':
          this.broadcast(
            envelope<CoordinatorToTabEnvelope>({
              kind: 'terminal-error',
              error: action.error,
              ...(action.storageUntouched ? { storageUntouched: true } : {}),
            })
          );
          break;
      }
    }
  }

  private startupProgress():
    | Extract<CoordinatorToTabEnvelope, { kind: 'engine-startup' }>
    | undefined {
    const state = this.coreValue?.state;
    if (state?.kind !== 'activating') return;
    return envelope<
      Extract<CoordinatorToTabEnvelope, { kind: 'engine-startup' }>
    >({
      kind: 'engine-startup',
      ownerEpoch: state.ownerEpoch,
      phase: state.phase,
      databaseAction: state.databaseAction,
      timeoutMs: match(state.phase)
        .with('loading-assets', () => this.assetLoadTimeoutMs)
        .with('awaiting-owner-lock', () => this.ownerLockWaitTimeoutMs)
        .with('opening-database', () => this.activationTimeoutMs)
        .exhaustive(),
    });
  }

  private armStartupWatchdog(tabId: string, ownerEpoch: number): void {
    this.clearActivationTimer();
    const progress = this.startupProgress();
    if (!progress) return;
    this.broadcast(progress);
    const { phase, timeoutMs } = progress;
    this.activationTimer = this.setTimeoutFn(() => {
      this.failOwner(
        tabId,
        ownerEpoch,
        match(phase)
          .with(
            'loading-assets',
            () => 'engine asset loading watchdog timed out'
          )
          .with(
            'awaiting-owner-lock',
            () => 'engine owner lock watchdog timed out'
          )
          .with(
            'opening-database',
            () => 'engine database opening watchdog timed out'
          )
          .exhaustive()
      );
    }, timeoutMs);
  }

  /** Tab ids holding this scope's liveness locks without registering here,
   * so they belong to another coordinator: another deployed build. */
  private async otherBuildTabIds(): Promise<string[] | undefined> {
    const core = this.coreValue;
    if (!core) return;
    let names: string[];
    try {
      names = await this.queryHeldLockNames();
    } catch {
      return;
    }
    const known = new Set(this.tabs.keys());
    for (const registration of this.pendingRegistrations.values()) {
      known.add(registration.tabId);
    }
    return names.flatMap((name) => {
      const tabId = tabIdFromLivenessLockName(core.scope, name);
      return tabId === undefined || known.has(tabId) ? [] : [tabId];
    });
  }

  /** A lock this build's previous owner frees within milliseconds; while
   * another build has live tabs, a lock still busy past the grace is theirs. */
  private async checkBusyOwnerLock(
    route: EngineRoute,
    elapsedMs: number
  ): Promise<void> {
    if (elapsedMs < this.otherBuildGraceMs) return;
    const others = await this.otherBuildTabIds();
    if (!others?.length || this.engineRoute !== route) return;
    this.closeUnavailable(
      route.tabId,
      route.ownerEpoch,
      'another build has live tabs'
    );
  }

  /** Fails closed without touching storage again: the owner lock stayed with
   * another context, or it kept the database files open (`storage-busy`). */
  private closeUnavailable(
    tabId: string,
    ownerEpoch: number,
    detail: string,
    cause: 'owner-lock' | 'storage-busy' = 'owner-lock'
  ): void {
    const core = this.coreValue;
    if (!core) return;
    const state = core.state;
    const actions =
      cause === 'storage-busy'
        ? core.storageBusy(tabId, ownerEpoch)
        : core.ownerLockUnavailable(tabId, ownerEpoch);
    if (actions.length === 0) return;
    this.activationStarted.delete(ownerEpoch);
    // Storage was not changed, or a busy wipe removed only part of it, so a
    // pending recovery wipe carries over to the next attempt exactly as after
    // a navigation departure.
    const interruptedResetReason =
      state.kind === 'activating' && state.databaseAction === 'wipe-before-open'
        ? this.pendingRecoveryResetEpochs.get(ownerEpoch)
        : undefined;
    if (interruptedResetReason !== undefined) {
      this.pendingRecoveryResetEpochs.delete(ownerEpoch);
      this.nextRecoveryResetReason = interruptedResetReason;
    }
    this.telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'error',
      ownerEvent:
        cause === 'storage-busy' ? 'storage-busy' : 'owner-lock-unavailable',
      errorCode: cause === 'storage-busy' ? 'opfs-io' : 'lock',
    });
    this.postTerminateEngine(
      tabId,
      ownerEpoch,
      cause === 'storage-busy'
        ? `cache database files stayed busy: ${detail}`
        : `cache database owner lock is unavailable: ${detail}`
    );
    this.clearEngineWatchdogs();
    this.resetRecoveryRetries();
    this.applyActions(actions);
  }

  /** Stale databases are deleted only once no other build could still use
   * them; the cleanup itself also skips any database whose lock is held. */
  private async allowStaleDatabaseRemoval(route: EngineRoute): Promise<void> {
    const others = await this.otherBuildTabIds();
    const state = this.coreValue?.state;
    if (
      others === undefined ||
      others.length > 0 ||
      this.engineRoute !== route ||
      state?.kind !== 'active' ||
      state.ownerEpoch !== route.ownerEpoch
    ) {
      return;
    }
    this.postToTab(
      route.tabId,
      envelope<CoordinatorToTabEnvelope>({
        kind: 'remove-stale-databases',
        tabId: route.tabId,
        ownerEpoch: route.ownerEpoch,
      })
    );
  }

  private scheduleResetActivation(): void {
    const core = this.coreValue;
    if (!core || core.state.kind !== 'resetting-after-loss') return;
    if (this.recoveryAttemptCount >= RECOVERY_RETRY_LIMIT) {
      const reason = `cache recovery failed after ${RECOVERY_RETRY_LIMIT} attempts: ${core.state.reason}`;
      this.clearRecoveryRetryTimer();
      this.applyActions(core.terminalFailure(reason));
      return;
    }

    this.recoveryAttemptCount += 1;
    const activate = () => {
      this.recoveryRetryTimer = undefined;
      if (this.coreValue) {
        this.applyActions(this.coreValue.resumeAfterLoss());
      }
    };
    if (this.recoveryAttemptCount === 1) {
      this.queueMicrotaskFn(activate);
      return;
    }
    const delayMs = recoveryRetryDelayMs(this.recoveryAttemptCount - 1);
    this.recoveryRetryTimer = this.setTimeoutFn(activate, delayMs);
  }

  private resetRecoveryRetries(): void {
    this.recoveryAttemptCount = 0;
    this.clearRecoveryRetryTimer();
  }

  private clearRecoveryRetryTimer(): void {
    if (this.recoveryRetryTimer === undefined) return;
    this.clearTimeoutFn(this.recoveryRetryTimer);
    this.recoveryRetryTimer = undefined;
  }

  private failOwner(
    tabId: string,
    ownerEpoch: number,
    reason: string,
    fatalCode?: EngineFatalCode,
    failureCode?: ActivationFailureCode
  ): void {
    const core = this.coreValue;
    if (!core) return;
    const actions = core.ownerLost(tabId, ownerEpoch, reason);
    if (actions.length === 0) return;
    this.activationStarted.delete(ownerEpoch);
    const next = core.state;
    if (
      next.kind === 'resetting-after-loss' &&
      next.databaseAction === 'wipe-before-open'
    ) {
      const pendingReason = this.recordPendingResetFailure(
        ownerEpoch,
        reason,
        failureCode
      );
      const resetReason =
        pendingReason ??
        (fatalCode === 'storage-reset-required'
          ? 'storage-reset-required'
          : 'abrupt-owner-loss');
      this.nextRecoveryResetReason = resetReason;
      if (pendingReason === undefined)
        this.recordStorageResetRequired(ownerEpoch, resetReason);
    }
    this.telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'abrupt',
      ownerEvent: 'abrupt-loss',
      errorCode:
        fatalCode === 'storage-reset-required'
          ? 'storage-reset'
          : classifyCacheError(reason),
    });
    for (const [routeId, timing] of this.routeStarted) {
      if (timing.ownerEpoch !== ownerEpoch) continue;
      this.routeStarted.delete(routeId);
      this.telemetry.record({
        name: 'graphql_cache.coordinator_request',
        operationCategory: timing.category,
        outcome: 'error',
        errorCode: 'owner-lost',
        durationMs: this.now() - timing.startedAt,
      });
    }
    this.postTerminateEngine(tabId, ownerEpoch, reason);
    this.clearEngineWatchdogs();
    this.applyActions(actions);
  }

  private departForNavigation(
    tabId: string,
    ownerEpoch: number,
    reason: string
  ): void {
    const core = this.coreValue;
    if (!core) return;
    const state = core.state;
    const isCurrentOwner =
      state.kind !== 'waiting-for-tab' &&
      state.kind !== 'resetting-after-loss' &&
      state.kind !== 'failed' &&
      state.tabId === tabId &&
      state.ownerEpoch === ownerEpoch;
    const actions = core.departForNavigation(tabId, ownerEpoch, reason);
    if (!isCurrentOwner) {
      this.applyActions(actions);
      return;
    }

    this.activationStarted.delete(ownerEpoch);
    const interruptedResetReason =
      state.kind === 'activating' && state.databaseAction === 'wipe-before-open'
        ? this.pendingRecoveryResetEpochs.get(ownerEpoch)
        : undefined;
    if (interruptedResetReason !== undefined) {
      this.pendingRecoveryResetEpochs.delete(ownerEpoch);
      this.nextRecoveryResetReason = interruptedResetReason;
    }
    this.telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'graceful',
      ownerEvent: 'navigation-departure',
    });
    for (const [routeId, timing] of this.routeStarted) {
      if (timing.ownerEpoch !== ownerEpoch) continue;
      this.routeStarted.delete(routeId);
      this.telemetry.record({
        name: 'graphql_cache.coordinator_request',
        operationCategory: timing.category,
        outcome: 'error',
        errorCode: 'owner-lost',
        durationMs: this.now() - timing.startedAt,
      });
    }
    this.clearEngineWatchdogs();
    this.applyActions(actions);
  }

  private loseTab(tabId: string, reason: string): void {
    const core = this.coreValue;
    if (!core) return;
    const state = core.state;
    if (
      state.kind !== 'waiting-for-tab' &&
      state.kind !== 'resetting-after-loss' &&
      state.kind !== 'failed' &&
      state.tabId === tabId
    ) {
      this.activationStarted.delete(state.ownerEpoch);
      if (
        state.kind !== 'activating' ||
        startupPhaseMayTouchStorage(state.phase) ||
        state.databaseAction === 'wipe-before-open'
      ) {
        const pendingReason = this.recordPendingResetFailure(
          state.ownerEpoch,
          reason
        );
        const resetReason = pendingReason ?? 'abrupt-owner-loss';
        this.nextRecoveryResetReason = resetReason;
        if (pendingReason === undefined)
          this.recordStorageResetRequired(state.ownerEpoch, resetReason);
      }
      this.telemetry.record({
        name: 'graphql_cache.owner',
        operationCategory: 'lifecycle',
        outcome: 'abrupt',
        ownerEvent: 'abrupt-loss',
        errorCode: classifyCacheError(reason),
      });
      for (const [routeId, timing] of this.routeStarted) {
        if (timing.ownerEpoch !== state.ownerEpoch) continue;
        this.routeStarted.delete(routeId);
        this.telemetry.record({
          name: 'graphql_cache.coordinator_request',
          operationCategory: timing.category,
          outcome: 'error',
          errorCode: 'owner-lost',
          durationMs: this.now() - timing.startedAt,
        });
      }
      // The page may still be alive after a liveness or MessagePort failure.
      // Tell it to kill the orphanable DedicatedWorker before dropping its port.
      this.postTerminateEngine(tabId, state.ownerEpoch, reason);
      this.clearEngineWatchdogs();
    }
    this.applyActions(core.tabLost(tabId, reason));
  }

  private recordStorageResetRequired(
    ownerEpoch: number,
    resetReason: CacheResetReason,
    openOutcome?: EngineOpenOutcome
  ): void {
    if (this.resetRequiredEpochs.has(ownerEpoch)) return;
    this.resetRequiredEpochs.add(ownerEpoch);
    this.telemetry.record({
      name: 'graphql_cache.storage_reset_required',
      operationCategory: 'storage',
      outcome: 'error',
      errorCode:
        resetReason === 'namespace-mismatch'
          ? 'schema'
          : resetReason === 'integrity-failure'
            ? 'integrity'
            : 'storage-reset',
      resetReason,
      openOutcome,
    });
  }

  private recordLogicalResetAndWipe(
    resetReason: CacheResetReason,
    openOutcome: EngineOpenOutcome,
    coordinatorWipe = true
  ): void {
    this.telemetry.record({
      name: 'graphql_cache.logical_reset',
      operationCategory: 'storage',
      outcome: 'success',
      errorCode: 'none',
      resetReason,
      openOutcome,
    });
    this.telemetry.record({
      name: 'graphql_cache.reset_wipe',
      operationCategory: 'storage',
      outcome: 'success',
      errorCode: 'none',
      resetReason,
      openOutcome,
      ...(coordinatorWipe ? { resetAttempt: 'wipe-before-open' as const } : {}),
    });
  }

  private recordPendingResetFailure(
    ownerEpoch: number,
    reason: string,
    failureCode?: ActivationFailureCode
  ): CacheResetReason | undefined {
    const resetReason = this.pendingRecoveryResetEpochs.get(ownerEpoch);
    if (resetReason === undefined) return;
    this.pendingRecoveryResetEpochs.delete(ownerEpoch);
    this.telemetry.record({
      name: 'graphql_cache.reset_wipe',
      operationCategory: 'storage',
      outcome: 'error',
      errorCode:
        failureCode === 'recovery-open-failed'
          ? 'storage-reset'
          : classifyCacheError(reason),
      resetReason,
      resetAttempt: 'wipe-before-open',
    });
    return resetReason;
  }

  private isCurrentOwner(tabId: string, ownerEpoch: number): boolean {
    const state = this.coreValue?.state;
    return Boolean(
      state &&
        state.kind !== 'waiting-for-tab' &&
        state.kind !== 'resetting-after-loss' &&
        state.kind !== 'failed' &&
        state.tabId === tabId &&
        state.ownerEpoch === ownerEpoch
    );
  }

  private postTerminateEngine(
    tabId: string,
    ownerEpoch: number,
    reason: string
  ): void {
    this.postToTab(
      tabId,
      envelope<CoordinatorToTabEnvelope>({
        kind: 'terminate-engine',
        tabId,
        ownerEpoch,
        reason,
      })
    );
  }

  private postCacheResponse(tabId: string, response: CacheResponse): void {
    this.postToTab(
      tabId,
      envelope<CoordinatorToTabEnvelope>({
        kind: 'cache-message',
        message: response,
      })
    );
  }

  private postToTab(tabId: string, message: CoordinatorToTabEnvelope): void {
    this.tabs.get(tabId)?.port.postMessage(message);
  }

  private broadcast(message: CoordinatorToTabEnvelope): void {
    for (const connection of this.tabs.values()) {
      connection.port.postMessage(message);
    }
  }

  private postProtocolError(
    port: CoordinatorMessagePort | undefined,
    error: string
  ): void {
    port?.postMessage(
      envelope<CoordinatorToTabEnvelope>({ kind: 'protocol-error', error })
    );
  }

  private removeTabConnection(tabId: string): void {
    const connection = this.tabs.get(tabId);
    if (!connection) return;
    this.tabs.delete(tabId);
    this.portTabs.delete(connection.port);
    connection.cancelLivenessWatch();
    connection.port.close();
  }

  private sendToEngine(
    route: EngineRoute,
    message: CoordinatorToEngineEnvelope
  ): boolean {
    try {
      Effect.runSync(route.transport.send(message));
      return true;
    } catch (error) {
      this.failOwner(
        route.tabId,
        route.ownerEpoch,
        `engine Effect transport send failed: ${errorMessage(error)}`
      );
      return false;
    }
  }

  private scheduleHeartbeat(ownerEpoch: number): void {
    this.clearHeartbeatTimers();
    this.heartbeatIntervalTimer = this.setTimeoutFn(() => {
      const route = this.engineRoute;
      const state = this.coreValue?.state;
      if (
        !route ||
        state?.kind !== 'active' ||
        state.ownerEpoch !== ownerEpoch
      ) {
        return;
      }
      const heartbeatId = this.nextHeartbeatId++;
      this.pendingHeartbeat = { ownerEpoch, heartbeatId };
      if (
        !this.sendToEngine(
          route,
          envelope<CoordinatorToEngineEnvelope>({
            kind: 'heartbeat',
            ownerEpoch,
            heartbeatId,
          })
        )
      ) {
        return;
      }
      this.heartbeatTimeoutTimer = this.setTimeoutFn(() => {
        void this.checkHeartbeatOwner(route, heartbeatId);
      }, this.heartbeatTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private async checkHeartbeatOwner(
    route: EngineRoute,
    heartbeatId: number
  ): Promise<void> {
    const core = this.coreValue;
    if (!core || this.engineRoute !== route) return;

    // A backgrounded/frozen page can suspend its DedicatedWorker while the
    // SharedWorker keeps running. A missed heartbeat is not evidence of a
    // crash: revoking ownership here wipes healthy storage and can exhaust
    // recovery while the page is still suspended. Only a released physical
    // owner lock confirms silent worker death (terminate() emits no error).
    let lockHeld: boolean;
    try {
      lockHeld = await this.verifyOwnerLockHeld(
        databaseOwnerLockName(core.scope)
      );
    } catch {
      // A failed probe is not proof of owner loss either. Retry later.
      lockHeld = true;
    }
    // The ack, a graceful drain, or another failure may have won the race
    // while the lock probe was pending. Never act on that stale observation.
    if (
      this.engineRoute !== route ||
      this.pendingHeartbeat?.ownerEpoch !== route.ownerEpoch ||
      this.pendingHeartbeat.heartbeatId !== heartbeatId
    ) {
      return;
    }
    if (!lockHeld) {
      this.failOwner(
        route.tabId,
        route.ownerEpoch,
        'engine owner lock was released'
      );
      return;
    }
    this.scheduleHeartbeat(route.ownerEpoch);
  }

  private acceptHeartbeat(ownerEpoch: number, heartbeatId: number): void {
    if (
      this.pendingHeartbeat?.ownerEpoch !== ownerEpoch ||
      this.pendingHeartbeat.heartbeatId !== heartbeatId
    ) {
      return;
    }
    if (this.heartbeatTimeoutTimer !== undefined) {
      this.clearTimeoutFn(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
    this.pendingHeartbeat = undefined;
    this.scheduleHeartbeat(ownerEpoch);
  }

  private clearActivationTimer(): void {
    if (this.activationTimer !== undefined) {
      this.clearTimeoutFn(this.activationTimer);
      this.activationTimer = undefined;
    }
  }

  private clearHeartbeatTimers(): void {
    if (this.heartbeatIntervalTimer !== undefined) {
      this.clearTimeoutFn(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = undefined;
    }
    if (this.heartbeatTimeoutTimer !== undefined) {
      this.clearTimeoutFn(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
    this.pendingHeartbeat = undefined;
  }

  private clearEngineWatchdogs(): void {
    this.clearActivationTimer();
    this.clearHeartbeatTimers();
  }
}
