import { describe, expect, it, vi } from 'vitest';
import type { CacheRequest } from '../protocol';
import { INITIAL_CACHE_REVISION } from '../protocol';
import {
  type CacheEngineRuntimeOptions,
  installCacheEngineWorker,
} from './cache-engine-runtime';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  databaseOwnerLockName,
  type PageToEngineEnvelope,
} from './coordinator-protocol';
import {
  type CoordinatorMessagePort,
  CoordinatorRouter,
} from './coordinator-router';
import {
  EFFECT_WORKER_REQUEST_TAG,
  EFFECT_WORKER_RESPONSE_TAG,
} from './effect-worker-transport';
import type { CacheWorkerCoreOptions } from './worker-core';

class FakePort extends EventTarget {
  readonly messages: unknown[] = [];
  closed = false;
  started = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }

  start(): void {
    this.started = true;
  }

  receive(message: unknown): void {
    const event = new MessageEvent('message', {
      data: [EFFECT_WORKER_REQUEST_TAG, message],
    });
    this.dispatchEvent(event);
  }
}

class FakeWorkerScope {
  closed = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  close(): void {
    this.closed = true;
  }

  activate(
    activation: PageToEngineEnvelope,
    port: FakePort | MessagePort
  ): void {
    this.onmessage?.({
      data: activation,
      ports: [port as MessagePort],
    } as unknown as MessageEvent);
  }
}

const version = {
  coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
} as const;

const activation = (
  databaseAction: 'open-existing' | 'wipe-before-open' = 'open-existing'
): PageToEngineEnvelope => ({
  ...version,
  kind: 'activate-engine',
  scope: 'scope',
  tabId: 'tab-a',
  ownerEpoch: 7,
  databaseAction,
  ownerLockName: 'owner-lock',
  hotCapacity: 11,
});

const effectPayload = (message: unknown): unknown =>
  Array.isArray(message) && message[0] === EFFECT_WORKER_RESPONSE_TAG
    ? message[1]
    : message;

const messagesOfKind = <T extends string>(port: FakePort, kind: T) =>
  port.messages
    .map(effectPayload)
    .filter(
      (message): message is Record<string, unknown> & { kind: T } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === kind
    );

const registerTab = async (
  router: CoordinatorRouter,
  port: FakePort,
  tabId: string
): Promise<void> => {
  await router.handleTabMessage(port as CoordinatorMessagePort, {
    ...version,
    kind: 'register-tab',
    scope: 'scope',
    tabId,
    livenessLockName: `graphql-cache-tab:scope:${tabId}`,
  });
};

const attachRuntime = async (
  router: CoordinatorRouter,
  tabPort: FakePort,
  tabId: string,
  ownerEpoch: number,
  databaseAction: 'open-existing' | 'wipe-before-open',
  createCore: NonNullable<CacheEngineRuntimeOptions['createCore']>,
  outbound?: unknown[]
): Promise<{ channel: MessageChannel; scope: FakeWorkerScope }> => {
  const channel = new MessageChannel();
  if (outbound) {
    const postMessage = channel.port2.postMessage.bind(channel.port2);
    channel.port2.postMessage = ((message: unknown) => {
      const payload = effectPayload(message);
      if (payload !== undefined) outbound.push(payload);
      postMessage(message);
    }) as MessagePort['postMessage'];
  }
  await router.handleTabMessage(tabPort as CoordinatorMessagePort, {
    ...version,
    kind: 'attach-engine-port',
    tabId,
    ownerEpoch,
    enginePort: channel.port1,
  });
  const scope = new FakeWorkerScope();
  installCacheEngineWorker({
    scope,
    ownerLockIsHeld: async () => true,
    createCore,
  });
  scope.activate(
    {
      ...version,
      kind: 'activate-engine',
      scope: 'scope',
      tabId,
      ownerEpoch,
      databaseAction,
      ownerLockName: databaseOwnerLockName('scope'),
    },
    channel.port2
  );
  await vi.waitFor(() =>
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      tabId,
      ownerEpoch,
    })
  );
  return { channel, scope };
};

const cacheResponses = (port: FakePort) =>
  messagesOfKind(port, 'cache-message').map(
    (message) => message.message as Record<string, unknown>
  );

describe('cache engine worker runtime', () => {
  it('selects atomic recovery-open and only proves wipe after initialization', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    let coreOptions: CacheWorkerCoreOptions | undefined;
    const handleRequest = vi.fn(
      async (
        port: { postMessage(message: unknown): void },
        request: CacheRequest
      ) => {
        expect(request).toMatchObject({
          kind: 'init',
          scope: 'scope',
          hotCapacity: 11,
        });
        port.postMessage({ id: request.id, ok: true, result: null });
      }
    );
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: (options) => {
        coreOptions = options;
        return {
          addPort: vi.fn(),
          handleRequest,
          drain: vi.fn(),
        };
      },
    });

    scope.activate(activation('wipe-before-open'), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    expect(coreOptions?.recoveryOpen).toBe(true);
    expect(messagesOfKind(direct, 'engine-ready')[0]).toMatchObject({
      tabId: 'tab-a',
      ownerEpoch: 7,
      databaseActionProof: 'wiped-before-open',
    });
  });

  it('throttles runtime linear memory, emits cached queue state, and drains high-water values', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    const observations: Array<Record<string, unknown>> = [];
    const recordCachedQueueDiagnostics = vi.fn();
    let now = 0;
    let memoryBytes = 10;
    installCacheEngineWorker({
      scope,
      now: () => now,
      readLinearMemoryBytes: () => memoryBytes,
      memoryTelemetryIntervalMs: 60_000,
      ownerLockIsHeld: async () => true,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
      createCore: () => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        recordCachedQueueDiagnostics,
        handleRequest: async (port, request) => {
          port.postMessage({ id: request.id, ok: true, result: null });
        },
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'heartbeat',
      ownerEpoch: 7,
      heartbeatId: 1,
    });
    now = 60_000;
    memoryBytes = 20;
    direct.receive({
      ...version,
      kind: 'heartbeat',
      ownerEpoch: 7,
      heartbeatId: 2,
    });
    memoryBytes = 15;
    direct.receive({
      ...version,
      kind: 'drain-engine',
      ownerEpoch: 7,
    });
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-drained')).toHaveLength(1)
    );

    expect(recordCachedQueueDiagnostics).toHaveBeenCalledTimes(2);
    expect(
      observations.filter(
        (observation) => observation.name === 'graphql_cache.linear_memory'
      )
    ).toEqual([
      expect.objectContaining({ bytes: 10, highWaterBytes: 10 }),
      expect.objectContaining({ bytes: 20, highWaterBytes: 20 }),
      expect.objectContaining({ bytes: 15, highWaterBytes: 20 }),
    ]);
  });

  it('fatals instead of forwarding a core-emitted coordinator-only error code', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: () => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            port.postMessage({ id: request.id, ok: true, result: null });
            return;
          }
          port.postMessage({
            id: request.id,
            ok: false,
            error: 'forged topology loss',
            errorCode: 'owner-epoch-lost',
          });
        },
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'engine-request',
      ownerEpoch: 7,
      routeId: 1,
      request: { id: 1, kind: 'clear' },
    });
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-fatal')).toHaveLength(1)
    );

    expect(messagesOfKind(direct, 'engine-response')).toHaveLength(0);
    expect(messagesOfKind(direct, 'engine-fatal')[0]).toMatchObject({
      reason: 'CacheWorkerCore emitted a coordinator-only cache error code',
      fatalCode: 'runtime-failure',
    });
  });

  it('keeps an earlier injected admission ahead of drain and response ordering', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    const order: string[] = [];
    let releaseHook!: () => void;
    const hookBlocker = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const handleRequest = vi.fn(
      async (
        port: { postMessage(message: unknown): void },
        request: CacheRequest
      ) => {
        if (request.kind === 'init') {
          port.postMessage({ id: request.id, ok: true, result: null });
          return;
        }
        order.push('request');
        port.postMessage({
          id: request.id,
          ok: true,
          result: { kind: 'miss' },
        });
      }
    );
    const drain = vi.fn(async () => {
      order.push('drain');
    });
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      hooks: {
        beforeRequest: async (request) => {
          if (request.kind === 'read') await hookBlocker;
        },
      },
      createCore: () => ({ addPort: vi.fn(), handleRequest, drain }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'engine-request',
      ownerEpoch: 7,
      routeId: 23,
      request: { id: 23, kind: 'read', query: 'query Slow { value }' },
    });
    direct.receive({
      ...version,
      kind: 'drain-engine',
      ownerEpoch: 7,
    });
    await Promise.resolve();
    expect(drain).not.toHaveBeenCalled();

    releaseHook();
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-drained')).toHaveLength(1)
    );

    expect(order).toEqual(['request', 'drain']);
    expect(
      direct.messages
        .map(effectPayload)
        .filter(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            ['engine-response', 'engine-drained'].includes(
              String((message as { kind?: unknown }).kind)
            )
        )
        .map((message) => (message as { kind: string }).kind)
    ).toEqual(['engine-response', 'engine-drained']);
    expect(direct.closed).toBe(true);
    expect(scope.closed).toBe(true);
  });

  it('drops core messages after the runner closes during drain', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    let corePort: { postMessage(message: unknown): void } | undefined;
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: () => ({
        addPort: (port) => {
          corePort = port;
        },
        handleRequest: async (port, request) => {
          port.postMessage({ id: request.id, ok: true, result: null });
        },
        drain: vi.fn(),
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() => expect(corePort).toBeDefined());

    direct.receive({
      ...version,
      kind: 'drain-engine',
      ownerEpoch: 7,
    });
    await vi.waitFor(() => expect(scope.closed).toBe(true));

    expect(() =>
      corePort?.postMessage({ id: 99, ok: true, result: null })
    ).not.toThrow();
    expect(messagesOfKind(direct, 'engine-response')).toHaveLength(0);
  });

  it('joins every admitted request fiber before draining the core', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    const order: string[] = [];
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    let releaseRequest!: () => void;
    const requestBlocked = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: () => ({
        addPort: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            port.postMessage({ id: request.id, ok: true, result: null });
            return;
          }
          order.push('request-started');
          markRequestStarted();
          await requestBlocked;
          order.push('request-finished');
          port.postMessage({ id: request.id, ok: true, result: null });
        },
        drain: async () => {
          order.push('drain');
        },
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'engine-request',
      ownerEpoch: 7,
      routeId: 24,
      request: { id: 24, kind: 'clear' },
    });
    await requestStarted;
    direct.receive({
      ...version,
      kind: 'drain-engine',
      ownerEpoch: 7,
    });
    await Promise.resolve();
    expect(order).toEqual(['request-started']);

    releaseRequest();
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-drained')).toHaveLength(1)
    );

    expect(order).toEqual(['request-started', 'request-finished', 'drain']);
    expect(scope.closed).toBe(true);
  });

  it('turns an admission fiber failure into one engine fatal', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    const handleRequest = vi.fn(async (port, request: CacheRequest) => {
      if (request.kind === 'init') {
        port.postMessage({ id: request.id, ok: true, result: null });
        return;
      }
      throw new Error('injected admission failure');
    });
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: () => ({
        addPort: vi.fn(),
        handleRequest,
        drain: vi.fn(),
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'engine-request',
      ownerEpoch: 7,
      routeId: 25,
      request: { id: 25, kind: 'clear' },
    });
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-fatal')).toHaveLength(1)
    );

    expect(messagesOfKind(direct, 'engine-fatal')[0]).toMatchObject({
      reason: expect.stringContaining('injected admission failure'),
      fatalCode: 'runtime-failure',
    });
    expect(messagesOfKind(direct, 'engine-response')).toHaveLength(0);
  });

  it('does not replay a completed mutation or leak its stale response and push after owner loss', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await registerTab(router, tabA, 'tab-a');
    await registerTab(router, tabB, 'tab-b');

    let effectCount = 0;
    let markEffectStarted!: () => void;
    const effectStarted = new Promise<void>((resolve) => {
      markEffectStarted = resolve;
    });
    let releaseOldOutput!: () => void;
    const oldOutputBlocked = new Promise<void>((resolve) => {
      releaseOldOutput = resolve;
    });
    let markOldOutputPosted!: () => void;
    const oldOutputPosted = new Promise<void>((resolve) => {
      markOldOutputPosted = resolve;
    });
    const oldRuntime = await attachRuntime(
      router,
      tabA,
      'tab-a',
      1,
      'open-existing',
      () => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            port.postMessage({ id: request.id, ok: true, result: null });
            return;
          }
          if (request.kind !== 'clear') return;
          effectCount += 1;
          markEffectStarted();
          await oldOutputBlocked;
          port.postMessage({ id: request.id, ok: true, result: null });
          port.postMessage({
            kind: 'cache-changed',
            revision: INITIAL_CACHE_REVISION,
          });
          markOldOutputPosted();
        },
      })
    );

    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 41, kind: 'clear' },
    });
    await effectStarted;
    expect(effectCount).toBe(1);
    expect(router.snapshot()?.inFlightRequestCount).toBe(1);

    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'engine-lost',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'injected owner failure after durable mutation',
    });
    await vi.waitFor(() =>
      expect(router.snapshot()?.state).toMatchObject({
        kind: 'activating',
        tabId: 'tab-b',
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      })
    );
    expect(cacheResponses(tabB)).toContainEqual({
      id: 41,
      ok: false,
      error: expect.stringContaining('owner epoch 1 was lost'),
      errorCode: 'owner-epoch-lost',
    });

    const replacementRequests: string[] = [];
    const replacementRuntime = await attachRuntime(
      router,
      tabB,
      'tab-b',
      2,
      'wipe-before-open',
      () => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            port.postMessage({ id: request.id, ok: true, result: null });
            return;
          }
          replacementRequests.push(request.kind);
        },
      })
    );

    releaseOldOutput();
    await oldOutputPosted;

    expect(effectCount).toBe(1);
    expect(replacementRequests).toEqual([]);
    expect(
      [...cacheResponses(tabA), ...cacheResponses(tabB)].filter(
        (message) => message.kind === 'cache-changed'
      )
    ).toEqual([]);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      ownerEpoch: 2,
    });

    oldRuntime.channel.port1.close();
    oldRuntime.channel.port2.close();
    replacementRuntime.channel.port1.close();
    replacementRuntime.channel.port2.close();
  });

  it('emits one authoritative reset sequence across live fatal and recovery replacement', async () => {
    const observations: Array<Record<string, unknown>> = [];
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await registerTab(router, tabA, 'tab-a');
    await registerTab(router, tabB, 'tab-b');

    const outbound: unknown[] = [];
    let markResetRequestStarted!: () => void;
    const resetRequestStarted = new Promise<void>((resolve) => {
      markResetRequestStarted = resolve;
    });
    let triggerReset!: () => void;
    const resetBlocked = new Promise<void>((resolve) => {
      triggerReset = resolve;
    });
    const runtime = await attachRuntime(
      router,
      tabA,
      'tab-a',
      1,
      'open-existing',
      (options) => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            port.postMessage({ id: request.id, ok: true, result: null });
            return;
          }
          if (request.kind === 'read') return;
          if (request.kind !== 'clear') return;
          markResetRequestStarted();
          await resetBlocked;
          options.onStorageResetRequired?.(
            Object.assign(new Error('storage reset'), {
              cacheStorageResetRequired: true as const,
            })
          );
          port.postMessage({
            id: request.id,
            ok: false,
            error: 'ordinary request error after reset marker',
          });
        },
      }),
      outbound
    );

    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 51, kind: 'read', query: 'query Pending { value }' },
    });
    await vi.waitFor(() =>
      expect(router.snapshot()?.inFlightRequestCount).toBe(1)
    );
    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 52, kind: 'clear' },
    });
    await resetRequestStarted;
    expect(router.snapshot()?.inFlightRequestCount).toBe(2);

    triggerReset();
    await vi.waitFor(() =>
      expect(router.snapshot()?.state).toMatchObject({
        kind: 'activating',
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      })
    );
    await vi.waitFor(() =>
      expect(
        outbound.filter(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            ['engine-fatal', 'engine-response'].includes(
              String((message as { kind?: unknown }).kind)
            )
        )
      ).toHaveLength(2)
    );

    const fatalAndResponse = outbound
      .filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          ['engine-fatal', 'engine-response'].includes(
            String((message as { kind?: unknown }).kind)
          )
      )
      .map((message) => (message as { kind: string }).kind);
    expect(fatalAndResponse).toEqual(['engine-fatal', 'engine-response']);
    expect(outbound).toContainEqual(
      expect.objectContaining({
        kind: 'engine-fatal',
        fatalCode: 'storage-reset-required',
      })
    );
    expect(router.snapshot()?.inFlightRequestCount).toBe(0);
    expect(cacheResponses(tabB)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 51,
          ok: false,
          error: expect.stringContaining(
            'cache storage requested physical reset'
          ),
        }),
        expect.objectContaining({
          id: 52,
          ok: false,
          error: expect.stringContaining(
            'cache storage requested physical reset'
          ),
        }),
      ])
    );
    expect(cacheResponses(tabB)).not.toContainEqual(
      expect.objectContaining({
        error: 'ordinary request error after reset marker',
      })
    );

    const replacementRuntime = await attachRuntime(
      router,
      tabB,
      'tab-b',
      2,
      'wipe-before-open',
      (options) => ({
        addPort: vi.fn(),
        drain: vi.fn(),
        handleRequest: async (port, request) => {
          if (request.kind === 'init') {
            options.onInitializationOutcome?.('reset-storage-uncertain');
            port.postMessage({ id: request.id, ok: true, result: null });
          }
        },
      })
    );
    expect(
      observations
        .filter((observation) =>
          [
            'graphql_cache.storage_reset_required',
            'graphql_cache.logical_reset',
            'graphql_cache.reset_wipe',
          ].includes(String(observation.name))
        )
        .map((observation) => observation.name)
    ).toEqual([
      'graphql_cache.storage_reset_required',
      'graphql_cache.logical_reset',
      'graphql_cache.reset_wipe',
    ]);
    expect(
      observations.filter(
        (observation) =>
          observation.name === 'graphql_cache.storage_reset_required'
      )
    ).toHaveLength(1);

    runtime.channel.port1.close();
    runtime.channel.port2.close();
    replacementRuntime.channel.port1.close();
    replacementRuntime.channel.port2.close();
  });

  it('reports a fatal error for a valid envelope with the wrong owner epoch', async () => {
    const scope = new FakeWorkerScope();
    const direct = new FakePort();
    const handleRequest = vi.fn(
      async (
        port: { postMessage(message: unknown): void },
        request: CacheRequest
      ) => {
        port.postMessage({ id: request.id, ok: true, result: null });
      }
    );
    installCacheEngineWorker({
      scope,
      ownerLockIsHeld: async () => true,
      createCore: () => ({
        addPort: vi.fn(),
        handleRequest,
        drain: vi.fn(),
      }),
    });
    scope.activate(activation(), direct);
    await vi.waitFor(() =>
      expect(messagesOfKind(direct, 'engine-ready')).toHaveLength(1)
    );

    direct.receive({
      ...version,
      kind: 'heartbeat',
      ownerEpoch: 8,
      heartbeatId: 1,
    });

    expect(messagesOfKind(direct, 'engine-fatal')).toContainEqual(
      expect.objectContaining({
        tabId: 'tab-a',
        ownerEpoch: 7,
        reason: 'coordinator envelope owner epoch does not match activation',
      })
    );
    expect(messagesOfKind(direct, 'heartbeat-ack')).toHaveLength(0);
  });
});
