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
import type { CacheTakeoverMessage } from './coordinator-takeover';

class FakePort extends EventTarget {
  readonly messages: unknown[] = [];
  readonly received: unknown[] = [];
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
    this.received.push(message);
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
  tabId: string,
  buildTime = 0
): Promise<void> => {
  await router.handleTabMessage(port as CoordinatorMessagePort, {
    ...version,
    kind: 'register-tab',
    scope: 'scope',
    tabId,
    livenessLockName: `graphql-cache-tab:scope:${tabId}`,
    buildTime,
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
  const sent = (kind: string) =>
    enginePort.received.some(
      (message) => (message as { kind?: unknown }).kind === kind
    );
  if (!sent('engine-assets-ready')) {
    enginePort.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId,
      ownerEpoch,
    });
  }
  if (!sent('owner-lock-acquired')) {
    enginePort.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId,
      ownerEpoch,
    });
  }
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

  it('backs off repeated recovery attempts and terminal-fails at the retry limit', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const initialEngine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, initialEngine);

    initialEngine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    initialEngine.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    initialEngine.receive({
      ...version,
      kind: 'activation-failed',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'initial OPFS open failed',
      failureCode: 'initialization-failed',
    });
    await vi.advanceTimersByTimeAsync(0);

    const backoffDelays = [100, 200, 400, 800];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const state = router.snapshot()?.state;
      expect(state).toMatchObject({
        kind: 'activating',
        ownerEpoch: attempt + 1,
        databaseAction: 'wipe-before-open',
      });
      if (state?.kind !== 'activating') {
        throw new Error('expected an activating recovery owner');
      }
      const tabId = state.tabId;
      const tab = tabId === 'tab-a' ? tabA : tabB;
      const engine = new FakePort();
      await attach(router, tab, tabId, state.ownerEpoch, engine);
      engine.receive({
        ...version,
        kind: 'engine-assets-ready',
        tabId,
        ownerEpoch: state.ownerEpoch,
      });
      engine.receive({
        ...version,
        kind: 'owner-lock-acquired',
        tabId,
        ownerEpoch: state.ownerEpoch,
      });
      engine.receive({
        ...version,
        kind: 'activation-failed',
        tabId,
        ownerEpoch: state.ownerEpoch,
        reason: 'OPFS path remove failed (NoModificationAllowedError)',
        failureCode: 'recovery-open-failed',
      });

      if (attempt === 5) break;
      expect(router.snapshot()?.state).toMatchObject({
        kind: 'resetting-after-loss',
        nextEpoch: attempt + 2,
      });
      const delay = backoffDelays[attempt - 1] ?? 0;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(router.snapshot()?.state.kind).toBe('resetting-after-loss');
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(router.snapshot()?.state).toEqual({
      kind: 'failed',
      reason: expect.stringContaining('cache recovery failed after 5 attempts'),
    });
    expect(messagesOfKind(tabA, 'terminal-error')).toEqual([
      expect.objectContaining({
        error: expect.stringContaining(
          'OPFS path remove failed (NoModificationAllowedError)'
        ),
      }),
    ]);
    expect(messagesOfKind(tabB, 'terminal-error')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(router.snapshot()?.state.kind).toBe('failed');
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
      buildTime: 0,
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

  const heldLocks = (names: () => string[]) => async (): Promise<string[]> =>
    names();

  const livenessLocks = (...tabIds: string[]) =>
    tabIds.map((tabId) => `graphql-cache-tab:scope:${tabId}`);

  const busy = (engine: FakePort): void => {
    engine.receive({
      ...version,
      kind: 'owner-lock-busy',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
  };

  const fakeTakeoverChannel = () => {
    const posted: CacheTakeoverMessage[] = [];
    let deliver: ((message: CacheTakeoverMessage) => void) | undefined;
    return {
      posted,
      open: (
        _scope: string,
        onMessage: (message: CacheTakeoverMessage) => void
      ) => {
        deliver = onMessage;
        return {
          post: (message: CacheTakeoverMessage) => posted.push(message),
          close: () => {},
        };
      },
      deliver: (message: CacheTakeoverMessage) => deliver?.(message),
    };
  };

  /** Two tabs of this build queue work while another build's tab is alive
   * and the engine finds the owner lock busy. */
  const askForAnotherBuildsDatabase = async () => {
    const observations: Array<{ name: string; ownerEvent?: string }> = [];
    const channel = fakeTakeoverChannel();
    const router = new CoordinatorRouter({
      takeoverReplyTimeoutMs: 100,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      queryHeldLockNames: heldLocks(() =>
        livenessLocks('tab-a', 'tab-b', 'other-build-tab')
      ),
      openTakeoverChannel: channel.open,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a', 2_000);
    await register(router, tabB, 'tab-b', 1_900);
    for (const [tab, tabId, request] of [
      [tabA, 'tab-a', { id: 1, kind: 'init', scope: 'scope' }],
      [tabB, 'tab-b', { id: 2, kind: 'clear' }],
    ] as const) {
      await router.handleTabMessage(tab as CoordinatorMessagePort, {
        ...version,
        kind: 'cache-request',
        tabId,
        request,
      });
    }
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    busy(engine);
    await vi.advanceTimersByTimeAsync(0);
    return { router, channel, observations, tabA, tabB, engine };
  };

  const expectFailedClosed = (
    tabA: FakePort,
    tabB: FakePort,
    reason: string
  ): void => {
    expect(messagesOfKind(tabA, 'terminate-engine')).toEqual([
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining(reason),
      }),
    ]);
    for (const [tab, requestId] of [
      [tabA, 1],
      [tabB, 2],
    ] as const) {
      expect(messagesOfKind(tab, 'cache-message')).toEqual([
        expect.objectContaining({
          message: expect.objectContaining({
            id: requestId,
            ok: false,
            errorCode: 'owner-lock-unavailable',
          }),
        }),
      ]);
      expect(messagesOfKind(tab, 'cache-unavailable')).toHaveLength(1);
    }
  };

  it('asks another build for its database and fails closed if nobody answers', async () => {
    vi.useFakeTimers();
    const { router, channel, observations, tabA, tabB, engine } =
      await askForAnotherBuildsDatabase();

    // The request carries the newest build among this coordinator's tabs.
    expect(channel.posted).toEqual([
      {
        takeover: 1,
        kind: 'request',
        scope: 'scope',
        requestId: expect.stringMatching(/^1:/),
        buildTime: 2_000,
      },
    ]);
    busy(engine);
    await vi.advanceTimersByTimeAsync(99);
    expect(channel.posted).toHaveLength(1);
    expect(messagesOfKind(tabB, 'cache-unavailable')).toHaveLength(0);

    // Builds from before handover never answer.
    await vi.advanceTimersByTimeAsync(1);
    expectFailedClosed(tabA, tabB, 'another build keeps the database');
    expect(
      observations.filter(
        (observation) => observation.ownerEvent === 'owner-lock-unavailable'
      )
    ).toHaveLength(1);
    expect(router.snapshot()?.state.kind).toBe('waiting-for-tab');

    // Nothing waits in line for the lock; a new tab starts a fresh attempt.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const tabC = new FakePort();
    await register(router, tabC, 'tab-c', 2_000);
    expect(messagesOfKind(tabC, 'become-owner')).toEqual([
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      }),
    ]);
  });

  it('fails closed at once when the holding build keeps its database', async () => {
    vi.useFakeTimers();
    const { channel, tabA, tabB } = await askForAnotherBuildsDatabase();
    const [request] = channel.posted;
    if (request?.kind !== 'request') throw new Error('missing request');

    channel.deliver({
      takeover: 1,
      kind: 'reply',
      scope: 'scope',
      requestId: request.requestId,
      decision: 'keep',
    });

    expectFailedClosed(tabA, tabB, 'another build keeps the database');
  });

  it('keeps retrying the lock while the holding build hands it over', async () => {
    vi.useFakeTimers();
    const { router, channel, observations, tabA, tabB, engine } =
      await askForAnotherBuildsDatabase();
    const [request] = channel.posted;
    if (request?.kind !== 'request') throw new Error('missing request');

    // A reply to some other request changes nothing.
    channel.deliver({
      takeover: 1,
      kind: 'reply',
      scope: 'scope',
      requestId: 'another-request',
      decision: 'keep',
    });
    channel.deliver({
      takeover: 1,
      kind: 'reply',
      scope: 'scope',
      requestId: request.requestId,
      decision: 'yield',
    });
    for (let attempt = 2; attempt <= 4; attempt += 1) busy(engine);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messagesOfKind(tabB, 'cache-unavailable')).toHaveLength(0);
    expect(channel.posted).toHaveLength(1);
    expect(
      observations.filter(
        (observation) => observation.ownerEvent === 'takeover-granted'
      )
    ).toHaveLength(1);

    ready(engine, 'tab-a', 1, 'opened-existing');
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      tabId: 'tab-a',
    });
    expect(messagesOfKind(tabA, 'terminate-engine')).toEqual([]);
  });

  it('asks for nothing once the engine took the lock during the lock query', async () => {
    vi.useFakeTimers();
    const channel = fakeTakeoverChannel();
    let answerQuery: ((names: string[]) => void) | undefined;
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      queryHeldLockNames: () =>
        new Promise<string[]>((resolve) => {
          answerQuery = resolve;
        }),
      openTakeoverChannel: channel.open,
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a', 2_000);
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });

    busy(engine);
    engine.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    answerQuery?.(livenessLocks('tab-a', 'other-build-tab'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(channel.posted).toEqual([]);
    expect(messagesOfKind(tab, 'cache-unavailable')).toEqual([]);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      phase: 'opening-database',
    });
  });

  it("never takes a departed owner's lingering liveness lock for another build", async () => {
    vi.useFakeTimers();
    const channel = fakeTakeoverChannel();
    const router = new CoordinatorRouter({
      takeoverReplyTimeoutMs: 100,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      // The departed page's lock is still held while its document unloads.
      queryHeldLockNames: heldLocks(() => livenessLocks('tab-a', 'tab-b')),
      openTakeoverChannel: channel.open,
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a', 1_000);
    await register(router, tabB, 'tab-b', 1_000);
    const first = new FakePort();
    await attach(router, tabA, 'tab-a', 1, first);
    ready(first, 'tab-a', 1, 'opened-existing');
    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'navigation-departure',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'page navigation',
    });
    const next = new FakePort();
    await attach(router, tabB, 'tab-b', 2, next);
    next.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-b',
      ownerEpoch: 2,
    });

    // The departing engine still holds the lock for a moment.
    next.receive({
      ...version,
      kind: 'owner-lock-busy',
      tabId: 'tab-b',
      ownerEpoch: 2,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(channel.posted).toEqual([]);
    expect(messagesOfKind(tabB, 'cache-unavailable')).toEqual([]);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      tabId: 'tab-b',
      phase: 'awaiting-owner-lock',
    });
  });

  /** An active engine of an older build, plus a second tab of that build. */
  const holdTheDatabase = async (buildTime: number) => {
    vi.useFakeTimers();
    const observations: Array<{ name: string; ownerEvent?: string }> = [];
    const channel = fakeTakeoverChannel();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      openTakeoverChannel: channel.open,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a', buildTime);
    await register(router, tabB, 'tab-b', buildTime);
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    const ask = (requestBuildTime: number) =>
      channel.deliver({
        takeover: 1,
        kind: 'request',
        scope: 'scope',
        requestId: 'request-1',
        buildTime: requestBuildTime,
      });
    return { router, channel, observations, tabA, tabB, engine, ask };
  };

  it('keeps its database for a build that is not newer', async () => {
    const { router, channel, tabA, tabB, engine, ask } =
      await holdTheDatabase(2_000);

    ask(2_000);
    ask(1_000);

    expect(channel.posted).toEqual([
      expect.objectContaining({ kind: 'reply', decision: 'keep' }),
      expect.objectContaining({ kind: 'reply', decision: 'keep' }),
    ]);
    expect(router.snapshot()?.state.kind).toBe('active');
    expect(messagesOfKind(engine, 'drain-engine')).toEqual([]);
    for (const tab of [tabA, tabB]) {
      expect(messagesOfKind(tab, 'cache-superseded')).toEqual([]);
    }
  });

  it('hands its database to a newer build and sends every tab there', async () => {
    const { router, channel, observations, tabA, tabB, engine, ask } =
      await holdTheDatabase(1_000);

    ask(2_000);

    expect(channel.posted).toEqual([
      {
        takeover: 1,
        kind: 'reply',
        scope: 'scope',
        requestId: 'request-1',
        decision: 'yield',
      },
    ]);
    for (const tab of [tabA, tabB]) {
      expect(messagesOfKind(tab, 'cache-superseded')).toHaveLength(1);
    }
    // The owner's page stops its engine itself when it leaves.
    expect(messagesOfKind(engine, 'drain-engine')).toEqual([]);
    expect(messagesOfKind(tabA, 'terminate-engine')).toEqual([]);
    expect(
      observations.filter(
        (observation) => observation.ownerEvent === 'superseded'
      )
    ).toHaveLength(1);
    // Superseded tabs are refused quietly while they wait to reload.
    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 5, kind: 'clear' },
    });
    expect(messagesOfKind(tabB, 'cache-message')).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          id: 5,
          ok: false,
          errorCode: 'owner-lock-unavailable',
        }),
      }),
    ]);

    await router.handleTabMessage(tabA as CoordinatorMessagePort, {
      ...version,
      kind: 'navigation-departure',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'page navigation',
    });
    expect(router.snapshot()?.state.kind).toBe('waiting-for-tab');
    expect(
      observations.filter(
        (observation) => observation.ownerEvent === 'abrupt-loss'
      )
    ).toEqual([]);

    // Nothing is elected again. A late tab of this build runs uncached rather
    // than reloading, which could land on this build again, and a second
    // request finds nothing left to hand over.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const tabC = new FakePort();
    await register(router, tabC, 'tab-c', 1_000);
    for (const tab of [tabA, tabB, tabC]) {
      expect(messagesOfKind(tab, 'become-owner')).toHaveLength(
        tab === tabA ? 1 : 0
      );
    }
    expect(messagesOfKind(tabC, 'cache-superseded')).toEqual([]);
    expect(messagesOfKind(tabC, 'cache-unavailable')).toHaveLength(1);
    ask(3_000);
    expect(channel.posted).toHaveLength(1);
  });

  it('sends the tabs of an idle older build to the newer one without answering', async () => {
    vi.useFakeTimers();
    const channel = fakeTakeoverChannel();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      openTakeoverChannel: channel.open,
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a', 1_000);
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    engine.receive({
      ...version,
      kind: 'owner-lock-unavailable',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(router.snapshot()?.state.kind).toBe('waiting-for-tab');

    channel.deliver({
      takeover: 1,
      kind: 'request',
      scope: 'scope',
      requestId: 'request-1',
      buildTime: 2_000,
    });

    expect(channel.posted).toEqual([]);
    expect(messagesOfKind(tab, 'cache-superseded')).toHaveLength(1);
  });

  it('retries a busy lock within one build until the engine gives up', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      queryHeldLockNames: heldLocks(() => livenessLocks('tab-a')),
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });

    busy(engine);
    await vi.advanceTimersByTimeAsync(0);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      phase: 'awaiting-owner-lock',
    });

    engine.receive({
      ...version,
      kind: 'owner-lock-unavailable',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(messagesOfKind(tab, 'cache-unavailable')).toHaveLength(1);
    expect(messagesOfKind(tab, 'terminate-engine')).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining('the engine stopped retrying'),
      }),
    ]);
  });

  it('fails closed without a wipe when an open finds the files still busy', async () => {
    vi.useFakeTimers();
    const observations: Array<{ name: string; ownerEvent?: string }> = [];
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
    await router.handleTabMessage(tabB as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-b',
      request: { id: 1, kind: 'clear' },
    });
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    for (const kind of [
      'engine-assets-ready',
      'owner-lock-acquired',
    ] as const) {
      engine.receive({ ...version, kind, tabId: 'tab-a', ownerEpoch: 1 });
    }

    // A predecessor, such as a reloading tab's worker, kept the files open.
    engine.receive({
      ...version,
      kind: 'activation-failed',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'OPFS sync handle open failed (NoModificationAllowedError)',
      failureCode: 'storage-busy',
    });

    expect(messagesOfKind(tabA, 'terminate-engine')).toEqual([
      expect.objectContaining({
        ownerEpoch: 1,
        reason: expect.stringContaining('files stayed busy'),
      }),
    ]);
    expect(messagesOfKind(tabB, 'cache-message')).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          id: 1,
          ok: false,
          errorCode: 'owner-lock-unavailable',
        }),
      }),
    ]);
    for (const tab of [tabA, tabB]) {
      expect(messagesOfKind(tab, 'cache-unavailable')).toEqual([
        expect.objectContaining({
          reason: expect.stringContaining('files are still open'),
        }),
      ]);
      expect(messagesOfKind(tab, 'terminal-error')).toEqual([]);
    }
    expect(
      observations.filter(
        (observation) => observation.ownerEvent === 'storage-busy'
      )
    ).toHaveLength(1);
    expect(
      observations.filter(
        (observation) =>
          observation.name === 'graphql_cache.reset_wipe' ||
          observation.name === 'graphql_cache.storage_reset_required'
      )
    ).toEqual([]);

    // Nothing retries in the background. A tab that registers later opens
    // the existing database instead of wiping it.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(messagesOfKind(tabB, 'become-owner')).toEqual([]);
    const tabC = new FakePort();
    await register(router, tabC, 'tab-c');
    expect(messagesOfKind(tabC, 'become-owner')).toEqual([
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      }),
    ]);
  });

  it('lets the owner delete stale databases only when no other build has tabs', async () => {
    vi.useFakeTimers();
    let locks = livenessLocks('tab-a', 'old-build-tab');
    const setup = async () => {
      const router = new CoordinatorRouter({
        verifyTabLockHeld: async () => true,
        watchTabLock: () => () => {},
        queryHeldLockNames: heldLocks(() => locks),
      });
      const tab = new FakePort();
      await register(router, tab, 'tab-a');
      const engine = new FakePort();
      await attach(router, tab, 'tab-a', 1, engine);
      ready(engine, 'tab-a', 1, 'opened-existing');
      await vi.advanceTimersByTimeAsync(0);
      return tab;
    };

    expect(
      messagesOfKind(await setup(), 'remove-stale-databases')
    ).toHaveLength(0);

    locks = livenessLocks('tab-a');
    expect(messagesOfKind(await setup(), 'remove-stale-databases')).toEqual([
      {
        ...version,
        kind: 'remove-stale-databases',
        tabId: 'tab-a',
        ownerEpoch: 1,
      },
    ]);
  });

  it('replaces an engine that stops reporting while it tries the owner lock', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      ownerLockWaitTimeoutMs: 30,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');
    const engine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, engine);
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });

    await vi.advanceTimersByTimeAsync(30);

    expect(messagesOfKind(tabA, 'terminate-engine')).toEqual([
      expect.objectContaining({
        reason: 'engine owner lock watchdog timed out',
      }),
    ]);
    // It never had the storage grant, so its replacement keeps the database.
    expect(messagesOfKind(tabB, 'become-owner')).toEqual([
      expect.objectContaining({
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      }),
    ]);
  });

  it('allows slow asset loading and reports phase budgets to owners and late joiners', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      assetLoadTimeoutMs: 100,
      ownerLockWaitTimeoutMs: 30,
      activationTimeoutMs: 10,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    const engine = new FakePort();
    await register(router, tabA, 'tab-a');
    await attach(router, tabA, 'tab-a', 1, engine);
    await vi.advanceTimersByTimeAsync(50);
    expect(messagesOfKind(tabA, 'terminate-engine')).toHaveLength(0);
    expect(messagesOfKind(engine, 'open-engine')).toHaveLength(0);
    await register(router, tabB, 'tab-b');
    for (const tab of [tabA, tabB]) {
      expect(messagesOfKind(tab, 'engine-startup').at(-1)).toMatchObject({
        ownerEpoch: 1,
        phase: 'loading-assets',
        timeoutMs: 100,
      });
    }
    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    // Loading assets grants no storage access; the lock wait comes first.
    expect(messagesOfKind(engine, 'open-engine')).toHaveLength(0);
    expect(messagesOfKind(tabB, 'engine-startup').at(-1)).toMatchObject({
      phase: 'awaiting-owner-lock',
      timeoutMs: 30,
    });
    engine.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(messagesOfKind(engine, 'open-engine')).toHaveLength(1);
    expect(messagesOfKind(tabB, 'engine-startup').at(-1)).toMatchObject({
      phase: 'opening-database',
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(9);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await vi.advanceTimersByTimeAsync(50);
    expect(router.snapshot()?.state.kind).toBe('active');
    expect(messagesOfKind(tabA, 'terminate-engine')).toHaveLength(0);
  });

  it('retries failed bootstrap without storage resets and keeps the queued init', async () => {
    vi.useFakeTimers();
    const observations: Array<{ name: string }> = [];
    const router = new CoordinatorRouter({
      assetLoadTimeoutMs: 10,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
      telemetry: {
        record: (event) => observations.push(event),
        flush: vi.fn(),
      },
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    await router.handleTabMessage(tab as CoordinatorMessagePort, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-a',
      request: { kind: 'init', id: 9, scope: 'scope' },
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'activating',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
    expect(router.snapshot()?.queuedRequestCount).toBe(1);
    expect(messagesOfKind(tab, 'cache-message')).toHaveLength(0);
    expect(
      observations.some(
        (event) => event.name === 'graphql_cache.storage_reset_required'
      )
    ).toBe(false);
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 2, engine);
    ready(engine, 'tab-a', 2, 'opened-existing');
    expect(messagesOfKind(engine, 'engine-request')).toHaveLength(1);
  });

  it('bounds repeated asset failures without ever requesting a wipe', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      assetLoadTimeoutMs: 10,
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => {},
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    await vi.advanceTimersByTimeAsync(2000);
    expect(router.snapshot()?.state.kind).toBe('failed');
    expect(messagesOfKind(tab, 'become-owner')).toHaveLength(6);
    expect(
      messagesOfKind(tab, 'become-owner').every(
        (message) => message.databaseAction === 'open-existing'
      )
    ).toBe(true);
    expect(messagesOfKind(tab, 'terminal-error')).toEqual([
      expect.objectContaining({ storageUntouched: true }),
    ]);
    const late = new FakePort();
    await register(router, late, 'tab-b');
    expect(messagesOfKind(late, 'terminal-error')).toEqual([
      expect.objectContaining({ storageUntouched: true }),
    ]);
  });

  it('preserves the owner and in-flight work through repeated missed heartbeats', async () => {
    vi.useFakeTimers();
    const verifyLockHeld = vi.fn(async () => true);
    const router = new CoordinatorRouter({
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      verifyOwnerLockHeld: verifyLockHeld,
      watchTabLock: () => () => {},
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await router.handleTabMessage(tab, {
      ...version,
      kind: 'cache-request',
      tabId: 'tab-a',
      request: { id: 42, kind: 'clear' },
    });
    const request = messagesOfKind(engine, 'engine-request')[0]!;

    // Background suspension can outlast every recovery attempt. A held
    // physical lock is still authoritative; silence is not owner loss.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      ownerEpoch: 1,
    });
    expect(messagesOfKind(tab, 'terminate-engine')).toHaveLength(0);
    expect(messagesOfKind(tab, 'terminal-error')).toHaveLength(0);
    expect(messagesOfKind(tab, 'cache-message')).toHaveLength(0);
    expect(verifyLockHeld).toHaveBeenCalledWith(databaseOwnerLockName('scope'));
    expect(messagesOfKind(engine, 'heartbeat').length).toBeGreaterThan(5);

    const heartbeat = messagesOfKind(engine, 'heartbeat').at(-1)!;
    engine.receive({
      ...version,
      kind: 'heartbeat-ack',
      ownerEpoch: 1,
      heartbeatId: heartbeat.heartbeatId,
    });
    engine.receive({
      ...version,
      kind: 'engine-response',
      ownerEpoch: 1,
      routeId: request.routeId,
      response: {
        id: request.routeId,
        ok: true,
        result: INITIAL_CACHE_REVISION,
      },
    });
    expect(messagesOfKind(tab, 'cache-message')).toEqual([
      expect.objectContaining({
        message: { id: 42, ok: true, result: INITIAL_CACHE_REVISION },
      }),
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(['ack', 'drain', 'replacement'] as const)(
    'ignores a late lock probe after %s',
    async (action) => {
      vi.useFakeTimers();
      let resolveProbe!: (held: boolean) => void;
      const probe = new Promise<boolean>((resolve) => {
        resolveProbe = resolve;
      });
      const verifyOwnerLockHeld = vi.fn(() => probe);
      const router = new CoordinatorRouter({
        heartbeatIntervalMs: 5,
        heartbeatTimeoutMs: 7,
        verifyTabLockHeld: async () => true,
        verifyOwnerLockHeld,
        watchTabLock: () => () => {},
      });
      const tab = new FakePort();
      await register(router, tab, 'tab-a');
      const engine = new FakePort();
      await attach(router, tab, 'tab-a', 1, engine);
      ready(engine, 'tab-a', 1, 'opened-existing');
      await vi.advanceTimersByTimeAsync(12);
      expect(verifyOwnerLockHeld).toHaveBeenCalledOnce();

      if (action === 'ack') {
        engine.receive({
          ...version,
          kind: 'heartbeat-ack',
          ownerEpoch: 1,
          heartbeatId: messagesOfKind(engine, 'heartbeat')[0]!.heartbeatId,
        });
      } else {
        await router.handleTabMessage(tab, {
          ...version,
          kind: action === 'drain' ? 'graceful-departure' : 'engine-lost',
          tabId: 'tab-a',
          ownerEpoch: 1,
          ...(action === 'replacement' ? { reason: 'worker failed' } : {}),
        });
        if (action === 'replacement') {
          await vi.advanceTimersByTimeAsync(0);
          const replacement = new FakePort();
          await attach(router, tab, 'tab-a', 2, replacement);
          ready(replacement, 'tab-a', 2, 'wiped-before-open');
        }
      }
      const before = router.snapshot();
      const terminations = messagesOfKind(tab, 'terminate-engine').length;
      resolveProbe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(router.snapshot()).toEqual(before);
      expect(messagesOfKind(tab, 'terminate-engine')).toHaveLength(
        terminations
      );
    }
  );

  it('retries failed lock probes without losing the owner', async () => {
    vi.useFakeTimers();
    const verifyOwnerLockHeld = vi.fn(async () => {
      throw new Error('lock service unavailable');
    });
    const router = new CoordinatorRouter({
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      verifyOwnerLockHeld,
      watchTabLock: () => () => {},
    });
    const tab = new FakePort();
    await register(router, tab, 'tab-a');
    const engine = new FakePort();
    await attach(router, tab, 'tab-a', 1, engine);
    ready(engine, 'tab-a', 1, 'opened-existing');
    await vi.advanceTimersByTimeAsync(36);
    expect(verifyOwnerLockHeld).toHaveBeenCalledTimes(3);
    expect(router.snapshot()?.state).toMatchObject({
      kind: 'active',
      ownerEpoch: 1,
    });
    expect(messagesOfKind(tab, 'terminate-engine')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('uses activation deadlines and confirmed engine lock loss to terminate and wipe', async () => {
    vi.useFakeTimers();
    const router = new CoordinatorRouter({
      activationTimeoutMs: 10,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 7,
      verifyTabLockHeld: async () => true,
      verifyOwnerLockHeld: async () => false,
      watchTabLock: () => () => {},
    });
    const tabA = new FakePort();
    const tabB = new FakePort();
    await register(router, tabA, 'tab-a');
    await register(router, tabB, 'tab-b');

    const openingEngine = new FakePort();
    await attach(router, tabA, 'tab-a', 1, openingEngine);
    openingEngine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    openingEngine.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(messagesOfKind(tabA, 'terminate-engine')).toContainEqual(
      expect.objectContaining({
        ownerEpoch: 1,
        reason: 'engine database opening watchdog timed out',
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
        reason: 'engine owner lock was released',
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
      buildTime: 0,
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

    engine.receive({
      ...version,
      kind: 'engine-assets-ready',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    engine.receive({
      ...version,
      kind: 'owner-lock-acquired',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
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
