import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  databaseOwnerLockName,
} from './coordinator-protocol';
import {
  type CoordinatorMessagePort,
  CoordinatorRouter,
} from './coordinator-router';

class FakePort extends EventTarget {
  readonly messages: unknown[] = [];
  readonly events: string[] = [];
  closed = false;
  started = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  effectProtocol = false;
  readonly throwKinds = new Set<string>();

  postMessage(message: unknown): void {
    const payload = effectPayload(message);
    const kind = String((payload as { kind?: unknown })?.kind ?? 'unknown');
    if (this.throwKinds.has(kind)) throw new Error(`${kind} send failed`);
    this.messages.push(message);
    this.events.push(`post:${kind}`);
  }

  close(): void {
    this.closed = true;
    this.events.push('close');
  }

  start(): void {
    this.started = true;
    if (this.effectProtocol) this.effectReady();
  }

  receive(message: unknown): void {
    if (this.effectProtocol) {
      this.dispatchEvent(new MessageEvent('message', { data: [1, message] }));
      return;
    }
    this.onmessage?.({ data: message, ports: [] } as unknown as MessageEvent);
  }

  effectReady(): void {
    this.dispatchEvent(new MessageEvent('message', { data: [0] }));
  }
}

const effectPayload = (message: unknown): unknown =>
  Array.isArray(message) && message[0] === 0 ? message[1] : message;

const version = {
  coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
} as const;

const register = async (
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

const attach = async (
  router: CoordinatorRouter,
  tabPort: FakePort,
  tabId: string,
  ownerEpoch: number,
  enginePort: FakePort
): Promise<void> => {
  enginePort.effectProtocol = true;
  await router.handleTabMessage(tabPort as CoordinatorMessagePort, {
    ...version,
    kind: 'attach-engine-port',
    tabId,
    ownerEpoch,
    enginePort: enginePort as unknown as MessagePort,
  });
};

const ready = (
  enginePort: FakePort,
  tabId: string,
  ownerEpoch: number,
  proof: 'opened-existing' | 'wiped-before-open'
): void => {
  enginePort.receive({
    ...version,
    kind: 'engine-ready',
    tabId,
    ownerEpoch,
    ownerLockName: databaseOwnerLockName('scope'),
    ownerLockHeld: true,
    databaseActionProof: proof,
    openOutcome:
      proof === 'wiped-before-open'
        ? 'reset-storage-uncertain'
        : 'opened-existing',
  });
};

const messagesOfKind = <T extends string>(port: FakePort, kind: T) =>
  port.messages
    .map(effectPayload)
    .filter(
      (message): message is Record<string, unknown> & { kind: T } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === kind
    );

describe('CoordinatorRouter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports recovery reset success only after ready proof and failure on activation failure', async () => {
    const observations: Array<Record<string, unknown>> = [];
    const setupRecovery = async () => {
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
      const engineA = new FakePort();
      await register(router, tabA, 'tab-a');
      await register(router, tabB, 'tab-b');
      await attach(router, tabA, 'tab-a', 1, engineA);
      ready(engineA, 'tab-a', 1, 'opened-existing');
      await router.handleTabMessage(tabA as CoordinatorMessagePort, {
        ...version,
        kind: 'engine-lost',
        tabId: 'tab-a',
        ownerEpoch: 1,
        reason: 'injected abrupt loss',
      });
      expect(router.snapshot()?.state).toMatchObject({
        kind: 'activating',
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      });
      expect(
        observations.filter(
          (observation) => observation.name === 'graphql_cache.reset_wipe'
        )
      ).toEqual([]);
      return { router, tabB };
    };

    const successful = await setupRecovery();
    const successfulEngine = new FakePort();
    await attach(
      successful.router,
      successful.tabB,
      'tab-b',
      2,
      successfulEngine
    );
    ready(successfulEngine, 'tab-b', 2, 'wiped-before-open');
    expect(
      observations.filter(
        (observation) => observation.name === 'graphql_cache.reset_wipe'
      )
    ).toEqual([
      expect.objectContaining({
        outcome: 'success',
        resetReason: 'abrupt-owner-loss',
      }),
    ]);

    observations.length = 0;
    const failed = await setupRecovery();
    const failedEngine = new FakePort();
    await attach(failed.router, failed.tabB, 'tab-b', 2, failedEngine);
    failedEngine.receive({
      ...version,
      kind: 'activation-failed',
      tabId: 'tab-b',
      ownerEpoch: 2,
      reason: 'OPFS recovery open failed',
      failureCode: 'recovery-open-failed',
    });
    expect(
      observations.filter(
        (observation) => observation.name === 'graphql_cache.reset_wipe'
      )
    ).toEqual([
      expect.objectContaining({
        outcome: 'error',
        resetReason: 'abrupt-owner-loss',
      }),
    ]);
  });

  it('registers only after independent liveness-lock contention succeeds', async () => {
    let releaseVerification: ((held: boolean) => void) | undefined;
    const verification = new Promise<boolean>((resolve) => {
      releaseVerification = resolve;
    });
    const router = new CoordinatorRouter({
      verifyTabLockHeld: () => verification,
      watchTabLock: () => () => {},
    });
    const port = new FakePort();

    const registration = register(router, port, 'tab-a');
    expect(port.messages).toEqual([]);
    expect(router.snapshot()).toBeUndefined();
    releaseVerification?.(true);
    await registration;

    expect(messagesOfKind(port, 'registered')).toHaveLength(1);
    expect(messagesOfKind(port, 'become-owner')).toContainEqual(
      expect.objectContaining({
        tabId: 'tab-a',
        ownerEpoch: 1,
        databaseAction: 'open-existing',
      })
    );
  });

  it('cancels an exact pending registration on MessagePort messageerror', async () => {
    let finishVerification!: (held: boolean) => void;
    const verification = new Promise<boolean>((resolve) => {
      finishVerification = resolve;
    });
    const router = new CoordinatorRouter({
      verifyTabLockHeld: () => verification,
      watchTabLock: () => () => {},
    });
    const stalePort = new FakePort();
    router.connect(stalePort as CoordinatorMessagePort);
    stalePort.receive({
      ...version,
      kind: 'register-tab',
      scope: 'scope',
      tabId: 'stale-tab',
      livenessLockName: 'graphql-cache-tab:scope:stale-tab',
    });

    stalePort.onmessageerror?.();
    finishVerification(true);
    await vi.waitFor(() => expect(stalePort.closed).toBe(true));
    await Promise.resolve();

    expect(messagesOfKind(stalePort, 'registered')).toHaveLength(0);
    expect(messagesOfKind(stalePort, 'become-owner')).toHaveLength(0);
    expect(router.snapshot()).toBeUndefined();

    const livePort = new FakePort();
    await register(router, livePort, 'live-tab');
    expect(messagesOfKind(livePort, 'become-owner')).toContainEqual(
      expect.objectContaining({ tabId: 'live-tab', ownerEpoch: 1 })
    );
    expect(router.snapshot()?.tabIds).toEqual(['live-tab']);
  });

  it('rejects registration when the page does not already hold its lock', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => false,
      watchTabLock: () => () => {},
    });
    const port = new FakePort();

    await register(router, port, 'tab-a');

    expect(port.closed).toBe(true);
    expect(messagesOfKind(port, 'protocol-error')).toContainEqual(
      expect.objectContaining({
        error: 'tab registration requires an already-held liveness lock',
      })
    );
    expect(router.snapshot()).toBeUndefined();
  });

  it('routes colliding tab ids through unique engine ids, restores responses, and fans pushes', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    const tabC = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    await register(router, tabC, 'tab-c');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 4, kind: 'clear' },
    });
    await router.handleTabMessage(tabC as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-c',
      request: { id: 4, kind: 'clear' },
    });
    const routes = messagesOfKind(engine, 'engine-request');
    expect(routes).toHaveLength(2);
    const first = routes[0]!;
    expect(first.routeId).not.toBe(routes[1]?.routeId);
    expect((first.request as { id: number }).id).toBe(first.routeId);

    const second = routes[1] as unknown as { routeId: number };
    engine.receive({
      ...version,
      kind: 'engine-response',
      ownerEpoch: 1,
      routeId: second.routeId,
      response: { id: second.routeId, ok: true, result: 'tab-c' },
    });
    expect(messagesOfKind(tabC, 'cache-message')).toContainEqual(
      expect.objectContaining({
        message: { id: 4, ok: true, result: 'tab-c' },
      })
    );

    engine.receive({
      ...version,
      kind: 'engine-push',
      ownerEpoch: 1,
      push: {
        kind: 'cache-changed',
        revision: INITIAL_CACHE_REVISION,
      },
    });
    for (const tab of [tabA, tabB, tabC]) {
      expect(messagesOfKind(tab, 'cache-message')).toContainEqual(
        expect.objectContaining({
          message: {
            kind: 'cache-changed',
            revision: INITIAL_CACHE_REVISION,
          },
        })
      );
    }
  });

  it('orders drain after earlier routes and elects open-existing only after drained', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 1, kind: 'clear' },
    });
    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'graceful-departure',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });

    expect(
      engine.messages
        .map(effectPayload)
        .filter(
          (message) =>
            typeof message === 'object' && message !== null && 'kind' in message
        )
        .slice(-2)
        .map((message) => (message as { kind: string }).kind)
    ).toEqual(['engine-request', 'drain-engine']);
    expect(messagesOfKind(tabB, 'become-owner')).toHaveLength(0);
    const route = messagesOfKind(engine, 'engine-request')[0] as unknown as {
      routeId: number;
    };
    engine.receive({
      ...version,
      kind: 'engine-response',
      ownerEpoch: 1,
      routeId: route.routeId,
      response: { id: route.routeId, ok: true, result: null },
    });
    engine.receive({
      ...version,
      kind: 'engine-drained',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });

    expect(messagesOfKind(tabB, 'become-owner')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      })
    );
    expect(tabA.closed).toBe(true);
  });

  it('elects open-existing after an owner navigation departure', async () => {
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
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'navigation-departure',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'pagehide',
    });

    expect(messagesOfKind(tabB, 'become-owner')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      })
    );
    expect(messagesOfKind(tabA, 'terminate-engine')).toHaveLength(0);
    expect(tabA.closed).toBe(true);
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.owner',
        outcome: 'graceful',
        ownerEvent: 'navigation-departure',
      })
    );
    expect(observations).not.toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.storage_reset_required',
      })
    );
  });

  it('retains wipe-before-open when a recovery owner navigates during activation', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'engine-lost',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'engine failed',
    });
    expect(messagesOfKind(tabB, 'become-owner')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      })
    );

    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'navigation-departure',
      tabId: 'tab-b',
      ownerEpoch: 2,
      reason: 'pagehide during recovery',
    });

    expect(messagesOfKind(tabA, 'become-owner')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 3,
        databaseAction: 'wipe-before-open',
      })
    );
  });

  it('counts an unknown response with the current direct-route tuple as stale', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    await register(router, tabA, 'tab-a');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    engine.receive({
      ...version,
      kind: 'engine-response',
      ownerEpoch: 1,
      routeId: 999,
      response: { id: 999, ok: true, result: 'stale' },
    });

    expect(router.snapshot()?.staleMessageDrops).toBe(1);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      ownerEpoch: 1,
    });
    expect(messagesOfKind(tabA, 'terminate-engine')).toHaveLength(0);
  });

  it('closes the engine port and fails its owner when transport construction throws', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    await register(router, tabA, 'tab-a');
    const engine = new FakePort();
    const addEventListener = engine.addEventListener.bind(engine);
    vi.spyOn(engine, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'messageerror') {
          throw new Error('listener setup failed');
        }
        addEventListener(type, listener, options);
      }
    );

    await expect(attach(router, tabA, 'tab-a', 1, engine)).resolves.toBe(
      undefined
    );

    expect(engine.closed).toBe(true);
    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining('listener setup failed'),
      })
    );
  });

  it('fails its owner instead of propagating an engine request send failure', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    engine.throwKinds.add('engine-request');

    await expect(
      router.handleTabMessage(tabB as CoordinatorMessagePort, {
        ...version,
        kind: 'cache-request',
        tabId: 'tab-b',
        request: { id: 20, kind: 'clear' },
      })
    ).resolves.toBeUndefined();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining('engine-request send failed'),
      })
    );
  });

  it('uses activation and heartbeat watchdogs to terminate and wipe', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      activationTimeoutMs: 10,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');

    await vi.advanceTimersByTimeAsync(11);
    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: 'engine activation watchdog timed out',
      })
    );
    expect(messagesOfKind(tabB, 'become-owner')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      })
    );

    const engine = new FakePort();
    await attach(router, tabB, 'tab-b', 2, engine);
    ready(engine, 'tab-b', 2, 'wiped-before-open');
    await vi.advanceTimersByTimeAsync(6);
    expect(messagesOfKind(engine, 'heartbeat')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(8);
    expect(messagesOfKind(tabB, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 2,
        reason: 'engine heartbeat watchdog timed out',
      })
    );
    expect(router.snapshot()?.state.kind).toBe('activating');
    expect(router.snapshot()?.ownerEpoch).toBe(3);
  });

  it('fails its owner without arming a watchdog when heartbeat send fails', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    engine.throwKinds.add('heartbeat');

    await vi.advanceTimersByTimeAsync(5);

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining('heartbeat send failed'),
      })
    );
    expect(messagesOfKind(engine, 'heartbeat')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('accepts heartbeat acknowledgements and rearms the watchdog', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    await vi.advanceTimersByTimeAsync(5);
    const ping = messagesOfKind(engine, 'heartbeat')[0] as unknown as {
      heartbeatId: number;
    };
    engine.receive({
      ...version,
      kind: 'heartbeat-ack',
      ownerEpoch: 1,
      heartbeatId: ping.heartbeatId,
    });
    await vi.advanceTimersByTimeAsync(6);

    expect(messagesOfKind(tab, 'terminate-engine')).toHaveLength(0);
    expect(messagesOfKind(engine, 'heartbeat')).toHaveLength(2);
  });

  it('uses liveness watcher release as the correctness path', async () => {
    const releases = new Map<string, () => void>();
    const cancels: string[] = [];
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: (lockName, onReleased) => {
        releases.set(lockName, onReleased);
        return () => cancels.push(lockName);
      },
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    const tabC = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    await register(router, tabC, 'tab-c');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    releases.get('graphql-cache-tab:scope:tab-b')?.();
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      tabId: 'tab-a',
    });
    releases.get('graphql-cache-tab:scope:tab-a')?.();
    await Promise.resolve();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: 'tab liveness lock was released',
      })
    );
    expect(tabA.events.indexOf('post:terminate-engine')).toBeLessThan(
      tabA.events.indexOf('close')
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
    expect(cancels).toEqual(
      expect.arrayContaining([
        'graphql-cache-tab:scope:tab-a',
        'graphql-cache-tab:scope:tab-b',
      ])
    );
  });

  it('removes a gracefully retiring owner before liveness-loss re-election', async () => {
    const releases = new Map<string, () => void>();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: (lockName, onReleased) => {
        releases.set(lockName, onReleased);
        return () => undefined;
      },
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'graceful-departure',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    releases.get('graphql-cache-tab:scope:tab-a')?.();
    await Promise.resolve();

    expect(router.snapshot()?.tabIds).toEqual(['tab-b']);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('terminates a live owner before dropping a MessagePort on messageerror', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    router.connect(tabA as CoordinatorMessagePort);
    tabA.receive({
      ...version,
      kind: 'register-tab',
      scope: 'scope',
      tabId: 'tab-a',
      livenessLockName: 'graphql-cache-tab:scope:tab-a',
    });
    await vi.waitFor(() =>
      expect(messagesOfKind(tabA, 'registered')).toHaveLength(1)
    );
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    tabA.onmessageerror?.();
    await Promise.resolve();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: 'tab MessagePort messageerror',
      })
    );
    expect(tabA.events.indexOf('post:terminate-engine')).toBeLessThan(
      tabA.events.indexOf('close')
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('fails the current owner on an engine envelope route-tuple mismatch', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    engine.receive({
      ...version,
      kind: 'engine-drained',
      tabId: 'different-tab',
      ownerEpoch: 1,
    });
    await Promise.resolve();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: 'engine envelope owner tuple does not match its direct route',
      })
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('fences an engine-originated topology error code instead of forwarding it', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 8, kind: 'clear' },
    });
    const route = messagesOfKind(engine, 'engine-request')[0] as unknown as {
      routeId: number;
    };

    // Enter through the router's direct engine port. Its strict envelope
    // validation must fence the owner; this is not merely a runtime unit path.
    engine.receive({
      ...version,
      kind: 'engine-response',
      ownerEpoch: 1,
      routeId: route.routeId,
      response: {
        id: route.routeId,
        ok: false,
        error: 'forged topology loss',
        errorCode: 'owner-epoch-lost',
      },
    });
    await Promise.resolve();

    expect(messagesOfKind(tabB, 'cache-message')).toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          id: 8,
          ok: false,
          error: expect.stringContaining('invalid engine envelope'),
          errorCode: 'owner-epoch-lost',
        }),
      })
    );
    expect(messagesOfKind(tabB, 'cache-message')).not.toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({ error: 'forged topology loss' }),
      })
    );
    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining('invalid engine envelope'),
      })
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('fails instead of clearing watchdogs for unexpected current engine-drained', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');

    engine.receive({
      ...version,
      kind: 'engine-drained',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    await Promise.resolve();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        reason: 'unexpected engine-drained from current direct route',
      })
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('treats malformed current-engine messages as uncertain owner loss', async () => {
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);

    engine.receive({ kind: 'engine-ready', ownerEpoch: 1 });
    await Promise.resolve();

    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        reason: expect.stringContaining('invalid engine envelope'),
      })
    );
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });
});
