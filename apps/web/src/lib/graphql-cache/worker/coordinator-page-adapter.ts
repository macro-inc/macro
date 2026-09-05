import * as Effect from 'effect/Effect';
import type { CacheRequest, WorkerMessage } from '../protocol';
import {
  type CacheTelemetryRecorderLike,
  classifyCacheError,
  isolateCacheTelemetry,
} from '../telemetry';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  type CoordinatorToTabEnvelope,
  isCacheRequest,
  type PageToEngineEnvelope,
  type TabToCoordinatorEnvelope,
  tabLivenessLockName,
  validateCoordinatorToTabEnvelope,
} from './coordinator-protocol';
import {
  createEffectWorkerTransport,
  type EffectWorkerTransport,
} from './effect-worker-transport';

export interface SharedWorkerLike {
  readonly port: MessagePort;
  onerror?: ((this: AbstractWorker, event: ErrorEvent) => unknown) | null;
}

export interface DedicatedWorkerLike {
  onerror: ((this: AbstractWorker, event: ErrorEvent) => unknown) | null;
  onmessageerror: ((this: Worker, event: MessageEvent) => unknown) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

export interface CacheCoordinatorPageAdapterOptions {
  scope: string;
  hotCapacity?: number;
  tabId?: string;
  createSharedWorker?: (scope: string) => SharedWorkerLike;
  createDedicatedWorker?: (
    scope: string,
    ownerEpoch: number
  ) => DedicatedWorkerLike;
  lockManager?: Pick<LockManager, 'request'>;
  onEngineReplaced?: (ownerEpoch: number) => void;
  onOwnerChanged?: (ownerEpoch: number | undefined) => void;
  onWorkerCreated?: (worker: DedicatedWorkerLike, ownerEpoch: number) => void;
  onWorkerTerminated?: (ownerEpoch: number, reason: string) => void;
  /** Advisory coordinator diagnostic after successful registration. */
  onProtocolError?: (error: Error) => void;
  /** Fatal SharedWorker/MessagePort/envelope failure after resources close. */
  onTerminalError?: (error: Error) => void;
  gracefulTimeoutMs?: number;
  /** Privacy-safe lifecycle recorder supplied by the browser host. */
  telemetry?: CacheTelemetryRecorderLike;
}

export interface PageAdapterDisposeOptions {
  graceful?: boolean;
  /** Preserve OPFS when a normal page navigation cannot await a drain. */
  preserveDatabase?: boolean;
}

interface CoordinatorConnection {
  worker: SharedWorkerLike;
  transport: EffectWorkerTransport<TabToCoordinatorEnvelope>;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 10_000;

const withVersion = <T extends { coordinatorVersion: 2 }>(
  value: T extends unknown ? Omit<T, 'coordinatorVersion'> : never
): T =>
  ({
    coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
    ...value,
  }) as unknown as T;

const defaultSharedWorkerFactory = (scope: string): SharedWorkerLike =>
  new SharedWorker(
    new URL('./cache.coordinator.shared-worker.ts', import.meta.url),
    { type: 'module', name: `graphql-cache-coordinator:${scope}` }
  );

const defaultDedicatedWorkerFactory = (
  scope: string,
  ownerEpoch: number
): DedicatedWorkerLike =>
  new Worker(new URL('./cache.engine-worker.ts', import.meta.url), {
    type: 'module',
    name: `graphql-cache-engine:${scope}:${ownerEpoch}`,
  });

/**
 * Import-safe page endpoint for the browser coordinator topology.
 * SharedWorker creation starts on first use; DedicatedWorker creation starts
 * only after a current-epoch election.
 */
export class CacheCoordinatorPageAdapter {
  readonly tabId: string;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;

  private readonly createSharedWorker: (scope: string) => SharedWorkerLike;
  private readonly createDedicatedWorker: (
    scope: string,
    ownerEpoch: number
  ) => DedicatedWorkerLike;
  private readonly lockManager: Pick<LockManager, 'request'> | undefined;
  private readonly gracefulTimeoutMs: number;
  private coordinatorConnection: CoordinatorConnection | undefined;
  private engineWorker: DedicatedWorkerLike | undefined;
  private ownerEpoch: number | undefined;
  private registered = false;
  private startPromise: Promise<void> | undefined;
  private resolveRegistration: (() => void) | undefined;
  private rejectRegistration: ((error: Error) => void) | undefined;
  private readonly queuedRequests: CacheRequest[] = [];
  private releaseLivenessLock: (() => void) | undefined;
  private disposePromise: Promise<void> | undefined;
  private resolveDispose: (() => void) | undefined;
  private gracefulTimeout: ReturnType<typeof setTimeout> | undefined;
  private disposeMode: 'graceful' | 'navigation' | 'abrupt' | undefined;
  private pagehideRegistered = false;
  private terminalErrorReported = false;
  private readonly terminatedOwnerEpochs = new Set<number>();
  private highestOwnerEpochSeen = 0;
  private latestEngineReplacedEpoch = 0;
  private closed = false;
  private readonly telemetry: CacheTelemetryRecorderLike;
  private readonly now = (): number =>
    globalThis.performance?.now() ?? Date.now();

  constructor(private readonly options: CacheCoordinatorPageAdapterOptions) {
    if (!options.scope) throw new Error('cache coordinator scope is required');
    if (
      options.hotCapacity !== undefined &&
      (!Number.isSafeInteger(options.hotCapacity) || options.hotCapacity <= 0)
    ) {
      throw new Error('hot capacity must be a positive integer');
    }
    this.tabId = options.tabId ?? crypto.randomUUID();
    this.createSharedWorker =
      options.createSharedWorker ?? defaultSharedWorkerFactory;
    this.createDedicatedWorker =
      options.createDedicatedWorker ?? defaultDedicatedWorkerFactory;
    this.lockManager = options.lockManager;
    this.gracefulTimeoutMs =
      options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
    this.telemetry = isolateCacheTelemetry(options.telemetry);
  }

  /** Acquires tab liveness and registers without constructing an engine. */
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('page adapter is closed'));
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveRegistration = resolve;
      this.rejectRegistration = reject;
    });
    void this.connect().catch((error: unknown) => {
      // Explicit disposal can settle start while lock acquisition is pending.
      // A later lock-manager rejection belongs to that closed attempt.
      if (this.closed) return;
      this.failTerminal(
        error instanceof Error ? error : new Error(String(error))
      );
    });
    return this.startPromise;
  }

  /** Queues unchanged cache RPC until registration and engine readiness. */
  postMessage(request: CacheRequest): void {
    if (!isCacheRequest(request)) {
      const error = new Error('invalid cache request');
      this.options.onProtocolError?.(error);
      if (
        typeof (request as { id?: unknown })?.id === 'number' &&
        Number.isSafeInteger((request as { id: number }).id)
      ) {
        this.emit({
          id: (request as { id: number }).id,
          ok: false,
          error: error.message,
        });
      }
      return;
    }
    if (this.closed) {
      this.emit({ id: request.id, ok: false, error: 'page adapter is closed' });
      return;
    }
    if (!this.registered) {
      this.queuedRequests.push(request);
      void this.start().catch(() => undefined);
      return;
    }
    this.postCoordinator(
      withVersion<TabToCoordinatorEnvelope>({
        kind: 'cache-request',
        tabId: this.tabId,
        request,
      })
    );
  }

  /** Drains gracefully, preserves storage for navigation, or drops abruptly. */
  dispose(options: PageAdapterDisposeOptions = {}): Promise<void> {
    const graceful = options.graceful === true;
    const preserveDatabase = !graceful && options.preserveDatabase === true;
    if (this.disposePromise) {
      if (!graceful && this.disposeMode === 'graceful' && !this.closed) {
        if (preserveDatabase) {
          this.disposeMode = 'navigation';
          this.departForNavigation(
            'page navigation interrupted graceful page disposal'
          );
        } else {
          this.disposeMode = 'abrupt';
          this.abortDispose('pagehide interrupted graceful page disposal');
        }
      }
      return this.disposePromise;
    }
    this.disposePromise = new Promise<void>((resolve) => {
      this.resolveDispose = resolve;
    });
    if (this.closed) {
      this.settleDispose();
      return this.disposePromise;
    }
    if (!this.coordinatorConnection) {
      this.disposeMode = 'abrupt';
      this.closed = true;
      this.registered = false;
      const error = new Error('page adapter was disposed during startup');
      this.rejectStartAndQueued(error);
      this.releaseLiveness();
      this.settleDispose();
      return this.disposePromise;
    }

    if (preserveDatabase) {
      this.disposeMode = 'navigation';
      this.departForNavigation('page navigation');
    } else if (graceful && this.ownerEpoch !== undefined) {
      this.disposeMode = 'graceful';
      const ownerEpoch = this.ownerEpoch;
      if (
        !this.postCoordinator(
          withVersion<TabToCoordinatorEnvelope>({
            kind: 'graceful-departure',
            tabId: this.tabId,
            ownerEpoch,
          })
        )
      ) {
        return this.disposePromise;
      }
      this.gracefulTimeout = setTimeout(() => {
        this.gracefulTimeout = undefined;
        if (this.closed) return;
        this.terminateEngine(ownerEpoch, 'graceful drain timed out', false);
        if (this.closed) return;
        this.postCoordinator(
          withVersion<TabToCoordinatorEnvelope>({
            kind: 'disconnect-tab',
            tabId: this.tabId,
            reason: 'graceful page disposal timed out',
          })
        );
        if (!this.closed) {
          this.failTerminal(new Error('graceful engine drain timed out'));
        }
      }, this.gracefulTimeoutMs);
    } else {
      this.disposeMode = 'abrupt';
      this.abortDispose('page disposed without graceful drain');
    }
    return this.disposePromise;
  }

  private departForNavigation(reason: string): void {
    this.clearGracefulTimeout();
    const ownerEpoch = this.ownerEpoch;
    if (ownerEpoch !== undefined) {
      this.terminateEngine(ownerEpoch, reason, false);
      if (!this.closed) {
        this.postCoordinator(
          withVersion<TabToCoordinatorEnvelope>({
            kind: 'navigation-departure',
            tabId: this.tabId,
            ownerEpoch,
            reason,
          })
        );
      }
    } else if (!this.closed) {
      this.postCoordinator(
        withVersion<TabToCoordinatorEnvelope>({
          kind: 'disconnect-tab',
          tabId: this.tabId,
          reason,
        })
      );
    }
    this.finishDispose();
  }

  private abortDispose(reason: string): void {
    this.clearGracefulTimeout();
    if (this.ownerEpoch !== undefined) {
      this.terminateEngine(this.ownerEpoch, reason, false);
    }
    if (!this.closed) {
      this.postCoordinator(
        withVersion<TabToCoordinatorEnvelope>({
          kind: 'disconnect-tab',
          tabId: this.tabId,
          reason,
        })
      );
    }
    this.finishDispose();
  }

  private async connect(): Promise<void> {
    const lockManager = this.lockManager ?? navigator.locks;
    if (
      typeof SharedWorker !== 'function' &&
      this.options.createSharedWorker === undefined
    ) {
      throw new Error('SharedWorker is unavailable');
    }
    if (
      typeof Worker !== 'function' &&
      this.options.createDedicatedWorker === undefined
    ) {
      throw new Error('DedicatedWorker is unavailable');
    }
    if (typeof MessageChannel !== 'function') {
      throw new Error('MessageChannel is unavailable');
    }
    if (!lockManager) throw new Error('Web Locks are unavailable');

    const livenessLockName = tabLivenessLockName(
      this.options.scope,
      this.tabId
    );
    const lockStartedAt = this.now();
    let acquired: (() => void) | undefined;
    let acquisitionFailed: ((error: Error) => void) | undefined;
    const acquiredPromise = new Promise<void>((resolve, reject) => {
      acquired = resolve;
      acquisitionFailed = reject;
    });
    const heldUntilReleased = new Promise<void>((resolve) => {
      this.releaseLivenessLock = resolve;
    });
    void lockManager
      .request(livenessLockName, { mode: 'exclusive' }, async (lock) => {
        if (!lock) {
          acquisitionFailed?.(new Error('tab liveness lock was not acquired'));
          return;
        }
        acquired?.();
        await heldUntilReleased;
      })
      .catch((error: unknown) => {
        acquisitionFailed?.(
          error instanceof Error ? error : new Error(String(error))
        );
      });
    try {
      await acquiredPromise;
    } catch (error) {
      this.telemetry.record({
        name: 'graphql_cache.lock_wait',
        operationCategory: 'lifecycle',
        outcome: 'error',
        errorCode: classifyCacheError(error),
        durationMs: this.now() - lockStartedAt,
      });
      throw error;
    }
    this.telemetry.record({
      name: 'graphql_cache.lock_wait',
      operationCategory: 'lifecycle',
      outcome: 'success',
      errorCode: 'none',
      durationMs: this.now() - lockStartedAt,
    });
    if (this.closed) return;

    const worker = this.createSharedWorker(this.options.scope);
    const closeUnpublishedWorker = (): void => {
      try {
        worker.onerror = null;
      } catch {
        // Raw endpoint closure remains authoritative during failed setup.
      }
      this.closePort(worker.port);
    };
    let transport: EffectWorkerTransport<TabToCoordinatorEnvelope>;
    try {
      worker.onerror = (event) => {
        event.preventDefault();
        this.failTerminal(
          new Error(event.message || 'SharedWorker transport error')
        );
      };
      transport = createEffectWorkerTransport<
        CoordinatorToTabEnvelope,
        TabToCoordinatorEnvelope
      >({
        endpoint: worker as SharedWorker,
        onMessage: (message) => {
          try {
            this.handleCoordinatorMessage(message);
          } catch (error) {
            this.failTerminal(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
        onError: (error) => {
          this.failTerminal(
            new Error(`coordinator Effect transport failed: ${error.message}`)
          );
        },
        closeEndpoint: () => this.closePort(worker.port),
      });
    } catch (error) {
      closeUnpublishedWorker();
      throw error;
    }
    if (this.closed) {
      try {
        worker.onerror = null;
      } catch {
        // The transport still owns endpoint closure below.
      }
      void Effect.runPromise(transport.close()).catch(() => undefined);
      return;
    }
    this.coordinatorConnection = { worker, transport };
    void transport.ready.catch(() => undefined);
    this.postCoordinator(
      withVersion<TabToCoordinatorEnvelope>({
        kind: 'register-tab',
        scope: this.options.scope,
        tabId: this.tabId,
        livenessLockName,
        hotCapacity: this.options.hotCapacity,
      })
    );
  }

  private handleCoordinatorMessage(rawMessage: unknown): void {
    const parsed = validateCoordinatorToTabEnvelope(rawMessage);
    if (!parsed.ok) {
      this.failTerminal(new Error(parsed.error));
      return;
    }
    const message = parsed.value;
    switch (message.kind) {
      case 'registered':
        if (message.tabId !== this.tabId || this.registered) {
          this.failTerminal(
            new Error('invalid coordinator registration acknowledgement')
          );
          return;
        }
        this.registered = true;
        this.resolveRegistration?.();
        this.resolveRegistration = undefined;
        this.rejectRegistration = undefined;
        this.registerPagehide();
        for (const request of this.queuedRequests.splice(0)) {
          this.postMessage(request);
        }
        break;
      case 'become-owner':
        if (
          message.tabId !== this.tabId ||
          message.scope !== this.options.scope
        ) {
          this.failTerminal(
            new Error('coordinator elected the wrong page or scope')
          );
          return;
        }
        if (
          message.ownerEpoch <= this.highestOwnerEpochSeen ||
          this.terminatedOwnerEpochs.has(message.ownerEpoch)
        ) {
          this.failTerminal(
            new Error(
              `coordinator elected stale or duplicate owner epoch ${message.ownerEpoch}`
            )
          );
          return;
        }
        this.highestOwnerEpochSeen = message.ownerEpoch;
        this.spawnEngine(message);
        break;
      case 'cache-message':
        this.emit(message.message);
        break;
      case 'terminate-engine':
        if (message.tabId !== this.tabId) {
          this.failTerminal(new Error('coordinator terminated the wrong page'));
          return;
        }
        if (
          !this.terminateEngine(message.ownerEpoch, message.reason, false) &&
          !this.terminatedOwnerEpochs.has(message.ownerEpoch)
        ) {
          this.failTerminal(
            new Error('coordinator terminated an unknown owner epoch')
          );
        }
        break;
      case 'retire-complete':
        if (
          message.tabId !== this.tabId ||
          !this.terminateEngine(
            message.ownerEpoch,
            'graceful engine retirement completed',
            false
          )
        ) {
          this.failTerminal(
            new Error('coordinator retired the wrong page or owner epoch')
          );
          return;
        }
        this.finishDispose();
        break;
      case 'engine-replaced':
        if (message.ownerEpoch <= this.latestEngineReplacedEpoch) return;
        this.latestEngineReplacedEpoch = message.ownerEpoch;
        this.highestOwnerEpochSeen = Math.max(
          this.highestOwnerEpochSeen,
          message.ownerEpoch
        );
        this.options.onEngineReplaced?.(message.ownerEpoch);
        break;
      case 'protocol-error': {
        const error = new Error(message.error);
        if (!this.registered) this.failTerminal(error);
        else this.options.onProtocolError?.(error);
        break;
      }
      case 'terminal-error':
        this.failTerminal(new Error(message.error));
        break;
    }
  }

  private spawnEngine(
    election: Extract<CoordinatorToTabEnvelope, { kind: 'become-owner' }>
  ): void {
    if (this.engineWorker || this.ownerEpoch !== undefined) {
      this.failTerminal(
        new Error('coordinator elected a page that already owns an engine')
      );
      return;
    }
    const worker = this.createDedicatedWorker(
      this.options.scope,
      election.ownerEpoch
    );
    this.engineWorker = worker;
    this.ownerEpoch = election.ownerEpoch;
    this.options.onOwnerChanged?.(election.ownerEpoch);
    this.options.onWorkerCreated?.(worker, election.ownerEpoch);

    worker.onerror = (event) => {
      event.preventDefault();
      const reason = event.message || 'dedicated engine worker error';
      const failedDuringDrain = this.disposeMode === 'graceful';
      this.terminateEngine(election.ownerEpoch, reason, !failedDuringDrain);
      if (failedDuringDrain && !this.closed) {
        this.failTerminal(new Error(reason));
      }
    };
    worker.onmessageerror = () => {
      const reason = 'dedicated engine worker messageerror';
      const failedDuringDrain = this.disposeMode === 'graceful';
      this.terminateEngine(election.ownerEpoch, reason, !failedDuringDrain);
      if (failedDuringDrain && !this.closed) {
        this.failTerminal(new Error(reason));
      }
    };

    const directChannel = new MessageChannel();
    if (
      !this.postCoordinator(
        withVersion<TabToCoordinatorEnvelope>({
          kind: 'attach-engine-port',
          tabId: this.tabId,
          ownerEpoch: election.ownerEpoch,
          enginePort: directChannel.port1,
        }),
        [directChannel.port1],
        [directChannel.port1]
      )
    ) {
      this.closePort(directChannel.port2);
      return;
    }
    try {
      worker.postMessage(
        withVersion<PageToEngineEnvelope>({
          kind: 'activate-engine',
          scope: election.scope,
          tabId: this.tabId,
          ownerEpoch: election.ownerEpoch,
          databaseAction: election.databaseAction,
          ownerLockName: election.ownerLockName,
          hotCapacity: election.hotCapacity,
        }),
        [directChannel.port2]
      );
    } catch (error) {
      this.closePort(directChannel.port2);
      this.failTerminal(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private terminateEngine(
    ownerEpoch: number,
    reason: string,
    reportLoss: boolean
  ): boolean {
    if (!this.engineWorker || this.ownerEpoch !== ownerEpoch) return false;
    const worker = this.engineWorker;
    let cleanupError: Error | undefined;
    try {
      worker.onerror = null;
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    try {
      worker.onmessageerror = null;
    } catch (error) {
      cleanupError ??=
        error instanceof Error ? error : new Error(String(error));
    }
    try {
      worker.terminate();
    } catch (error) {
      cleanupError ??=
        error instanceof Error ? error : new Error(String(error));
    }
    this.terminatedOwnerEpochs.add(ownerEpoch);
    this.engineWorker = undefined;
    this.ownerEpoch = undefined;
    try {
      this.options.onOwnerChanged?.(undefined);
      this.options.onWorkerTerminated?.(ownerEpoch, reason);
    } catch (error) {
      cleanupError ??=
        error instanceof Error ? error : new Error(String(error));
    }
    if (cleanupError) {
      this.failTerminal(cleanupError);
    } else if (reportLoss && this.coordinatorConnection && !this.closed) {
      this.postCoordinator(
        withVersion<TabToCoordinatorEnvelope>({
          kind: 'engine-lost',
          tabId: this.tabId,
          ownerEpoch,
          reason,
        })
      );
    }
    return true;
  }

  private emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  }

  private postCoordinator(
    message: TabToCoordinatorEnvelope,
    transfer: Transferable[] = [],
    untransferredPorts: MessagePort[] = []
  ): boolean {
    const connection = this.coordinatorConnection;
    if (!connection) {
      for (const untransferredPort of untransferredPorts) {
        this.closePort(untransferredPort);
      }
      if (!this.closed) {
        this.failTerminal(new Error('coordinator MessagePort is unavailable'));
      }
      return false;
    }
    try {
      Effect.runSync(connection.transport.send(message, transfer));
      return true;
    } catch (error) {
      for (const untransferredPort of untransferredPorts) {
        this.closePort(untransferredPort);
      }
      this.failTerminal(
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  private registerPagehide(): void {
    if (this.pagehideRegistered || typeof addEventListener !== 'function') {
      return;
    }
    this.pagehideRegistered = true;
    addEventListener(
      'pagehide',
      () => {
        void this.dispose({ graceful: false, preserveDatabase: true });
      },
      { once: true }
    );
  }

  private failTerminal(error: Error): void {
    if (this.terminalErrorReported) return;
    this.terminalErrorReported = true;
    this.closed = true;
    this.registered = false;
    this.clearGracefulTimeout();
    if (this.ownerEpoch !== undefined) {
      this.terminateEngine(this.ownerEpoch, error.message, false);
    }
    this.closeCoordinatorPort();
    this.releaseLiveness();
    this.rejectStartAndQueued(error);
    this.settleDispose();
    try {
      this.options.onTerminalError?.(error);
    } catch {
      // Terminal cleanup is complete; observers cannot reopen the transport.
    }
  }

  private finishDispose(): void {
    this.closed = true;
    this.registered = false;
    this.clearGracefulTimeout();
    this.closeCoordinatorPort();
    this.releaseLiveness();
    this.rejectStartAndQueued(new Error('page adapter was disposed'));
    this.settleDispose();
  }

  private rejectStartAndQueued(error: Error): void {
    this.rejectRegistration?.(error);
    this.rejectRegistration = undefined;
    this.resolveRegistration = undefined;
    for (const request of this.queuedRequests.splice(0)) {
      try {
        this.emit({ id: request.id, ok: false, error: error.message });
      } catch {
        // One consumer callback cannot prevent settlement of later requests.
      }
    }
  }

  private closeCoordinatorPort(): void {
    const connection = this.coordinatorConnection;
    this.coordinatorConnection = undefined;
    if (!connection) return;
    try {
      connection.worker.onerror = null;
    } catch {
      // Continue closing even if a test double rejects detachment.
    }
    void Effect.runPromise(connection.transport.close()).catch(() => undefined);
  }

  private closePort(port: Pick<MessagePort, 'close'>): void {
    try {
      port.close();
    } catch {
      // Closing is best-effort after ownership has already been abandoned.
    }
  }

  private clearGracefulTimeout(): void {
    if (this.gracefulTimeout === undefined) return;
    clearTimeout(this.gracefulTimeout);
    this.gracefulTimeout = undefined;
  }

  private settleDispose(): void {
    this.resolveDispose?.();
    this.resolveDispose = undefined;
  }

  private releaseLiveness(): void {
    const release = this.releaseLivenessLock;
    this.releaseLivenessLock = undefined;
    try {
      release?.();
    } catch {
      // Promise resolvers do not throw, but cleanup must remain exception-safe.
    }
  }
}

/** Creates a lazy, import-safe page coordinator endpoint. */
export function createCacheCoordinatorPageAdapter(
  options: CacheCoordinatorPageAdapterOptions
): CacheCoordinatorPageAdapter {
  return new CacheCoordinatorPageAdapter(options);
}
