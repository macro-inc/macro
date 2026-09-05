import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCacheCoordinatorPageAdapter,
  type DedicatedWorkerLike,
  type SharedWorkerLike,
} from './coordinator-page-adapter';
import { CACHE_COORDINATOR_PROTOCOL_VERSION } from './coordinator-protocol';

class FakeCoordinatorPort extends EventTarget {
  readonly messages: Array<{ message: unknown; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = () => {
    this.dispatchEvent(new MessageEvent('messageerror'));
  };
  closed = false;
  readonly events: string[] = [];
  readonly throwKinds = new Set<string>();

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (Array.isArray(message) && message[0] === 1) {
      this.events.push('post:effect-close');
      return;
    }
    const payload =
      Array.isArray(message) && message[0] === 0 ? message[1] : message;
    const kind = String((payload as { kind?: unknown }).kind);
    this.events.push(`post:${kind}`);
    if (this.throwKinds.has(kind)) throw new Error(`${kind} send failed`);
    this.messages.push({ message: payload, transfer });
  }

  start(): void {
    this.dispatchEvent(new MessageEvent('message', { data: [0] }));
  }

  close(): void {
    this.closed = true;
    this.events.push('close');
  }

  receive(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: [1, message] }));
  }
}

class FakeTransferPort {
  onmessage = null;
  onmessageerror = null;
  closed = false;
  postMessage(): void {}
  start(): void {}
  close(): void {
    this.closed = true;
  }
}

class FakeMessageChannel {
  static readonly instances: FakeMessageChannel[] = [];
  port1 = new FakeTransferPort();
  port2 = new FakeTransferPort();

  constructor() {
    FakeMessageChannel.instances.push(this);
  }
}

class FakeWorker implements DedicatedWorkerLike {
  onerror: DedicatedWorkerLike['onerror'] = null;
  onmessageerror: DedicatedWorkerLike['onmessageerror'] = null;
  readonly messages: Array<{ message: unknown; transfer: Transferable[] }> = [];
  terminated = false;
  throwOnPost = false;

  postMessage(message: unknown, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error('activate-engine send failed');
    this.messages.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const version = {
  coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
} as const;

const heldLockManager = (events: string[] = []) =>
  ({
    request: vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown
      ) => {
        events.push(`lock:${name}`);
        return await callback({ name, mode: 'exclusive' } as Lock);
      }
    ),
  }) as unknown as Pick<LockManager, 'request'>;

const election = (ownerEpoch: number) => ({
  ...version,
  kind: 'become-owner',
  scope: 'scope',
  tabId: 'tab-a',
  ownerEpoch,
  databaseAction:
    ownerEpoch === 1
      ? ('open-existing' as const)
      : ('wipe-before-open' as const),
  ownerLockName: 'physical-lock',
});

describe('CacheCoordinatorPageAdapter', () => {
  beforeEach(() => {
    FakeMessageChannel.instances.length = 0;
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is construction-safe, creates SharedWorker on first use, and DedicatedWorker only on election', async () => {
    const events: string[] = [];
    const coordinatorPort = new FakeCoordinatorPort();
    const sharedFactory = vi.fn(() => {
      events.push('shared-worker');
      return { port: coordinatorPort as unknown as MessagePort };
    });
    const dedicatedFactory = vi.fn(() => new FakeWorker());
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(events),
      createSharedWorker: sharedFactory,
      createDedicatedWorker: dedicatedFactory,
    });

    expect(events).toEqual([]);
    expect(sharedFactory).not.toHaveBeenCalled();
    expect(dedicatedFactory).not.toHaveBeenCalled();

    adapter.postMessage({ id: 1, kind: 'clear' });
    await vi.waitFor(() => expect(sharedFactory).toHaveBeenCalledOnce());
    expect(events).toEqual([
      'lock:graphql-cache-tab:scope:tab-a',
      'shared-worker',
    ]);
    expect(dedicatedFactory).not.toHaveBeenCalled();
    expect(
      (coordinatorPort.messages[0]!.message as { kind?: string }).kind
    ).toBe('register-tab');

    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    expect(
      coordinatorPort.messages.some(
        ({ message }) => (message as { kind?: string }).kind === 'cache-request'
      )
    ).toBe(true);
    expect(dedicatedFactory).not.toHaveBeenCalled();

    coordinatorPort.receive(election(1));
    expect(dedicatedFactory).toHaveBeenCalledOnce();
    const attach = coordinatorPort.messages.find(
      ({ message }) =>
        (message as { kind?: string }).kind === 'attach-engine-port'
    );
    expect(attach?.transfer).toHaveLength(1);
  });

  it('terminates and clears a failed worker before reporting owner loss', async () => {
    const order: string[] = [];
    const coordinatorPort = new FakeCoordinatorPort();
    const worker = new FakeWorker();
    worker.terminate = () => {
      worker.terminated = true;
      order.push('terminated');
    };
    coordinatorPort.postMessage = (message, transfer = []) => {
      const payload =
        Array.isArray(message) && message[0] === 0 ? message[1] : message;
      coordinatorPort.messages.push({ message: payload, transfer });
      if ((payload as { kind?: string }).kind === 'engine-lost') {
        order.push('loss-reported');
      }
    };
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    worker.onerror?.call(
      {} as AbstractWorker,
      {
        message: 'worker crashed',
        preventDefault: vi.fn(),
      } as unknown as ErrorEvent
    );

    expect(order).toEqual(['terminated', 'loss-reported']);
    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.messages).toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          kind: 'engine-lost',
          ownerEpoch: 1,
          reason: 'worker crashed',
        }),
      })
    );
  });

  it('accepts same-page replacement only after the failed worker was cleared', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const workers = [new FakeWorker(), new FakeWorker()];
    const dedicatedFactory = vi.fn(() => workers.shift() as FakeWorker);
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: dedicatedFactory,
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));
    coordinatorPort.receive({
      ...version,
      kind: 'terminate-engine',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'heartbeat timeout',
    });
    coordinatorPort.receive(election(2));

    expect(dedicatedFactory).toHaveBeenCalledTimes(2);
  });

  it('forwards validated cache messages and closes on malformed envelopes', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => new FakeWorker(),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const messages: unknown[] = [];
    adapter.onmessage = (event) => messages.push(event.data);
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;

    coordinatorPort.receive({
      ...version,
      kind: 'cache-message',
      message: { id: 8, ok: true, result: 'ok' },
    });
    coordinatorPort.receive({
      ...version,
      kind: 'cache-message',
      message: { id: 'bad', ok: true, result: 'ignored' },
    });

    expect(messages).toEqual([{ id: 8, ok: true, result: 'ok' }]);
    expect(terminalErrors).toEqual([
      'invalid cache-message coordinator envelope',
    ]);
    expect(coordinatorPort.closed).toBe(true);
  });

  it('settles queued RPC and does not retry construction after startup fails', async () => {
    const sharedFactory = vi.fn(() => {
      throw new Error('coordinator construction failed');
    });
    const terminalErrors: string[] = [];
    const messages: unknown[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: sharedFactory,
      createDedicatedWorker: () => new FakeWorker(),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    adapter.onmessage = (event) => messages.push(event.data);

    adapter.postMessage({ id: 1, kind: 'clear' });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    adapter.postMessage({ id: 2, kind: 'clear' });

    expect(sharedFactory).toHaveBeenCalledOnce();
    expect(messages).toEqual([
      { id: 1, ok: false, error: 'coordinator construction failed' },
      { id: 2, ok: false, error: 'page adapter is closed' },
    ]);
    expect(terminalErrors).toEqual(['coordinator construction failed']);
  });

  it('closes an unpublished SharedWorker when Effect transport setup fails', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const addEventListener =
      coordinatorPort.addEventListener.bind(coordinatorPort);
    vi.spyOn(coordinatorPort, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'messageerror') {
          throw new Error('transport listener setup failed');
        }
        addEventListener(type, listener, options);
      }
    );
    const terminalErrors: string[] = [];
    const messages: unknown[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => new FakeWorker(),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    adapter.onmessage = (event) => messages.push(event.data);

    adapter.postMessage({ id: 1, kind: 'clear' });
    await vi.waitFor(() => expect(messages).toHaveLength(1));

    expect(coordinatorPort.closed).toBe(true);
    expect(coordinatorPort.events.filter((event) => event === 'close')).toEqual(
      ['close']
    );
    expect(messages).toEqual([
      { id: 1, ok: false, error: 'transport listener setup failed' },
    ]);
    expect(terminalErrors).toEqual(['transport listener setup failed']);
  });

  it('keeps registered coordinator protocol diagnostics advisory', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const protocolErrors: string[] = [];
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => new FakeWorker(),
      onProtocolError: (error) => protocolErrors.push(error.message),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;

    coordinatorPort.receive({
      ...version,
      kind: 'protocol-error',
      error: 'another tab sent a stale envelope',
    });

    expect(protocolErrors).toEqual(['another tab sent a stale envelope']);
    expect(terminalErrors).toEqual([]);
    expect(coordinatorPort.closed).toBe(false);
    await adapter.dispose();
  });

  it('treats retry exhaustion from the coordinator as terminal', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => new FakeWorker(),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;

    coordinatorPort.receive({
      ...version,
      kind: 'terminal-error',
      error: 'cache recovery failed after 5 attempts',
    });

    expect(terminalErrors).toEqual(['cache recovery failed after 5 attempts']);
    expect(coordinatorPort.closed).toBe(true);
  });

  it('terminates an owned engine before closing a failed SharedWorker transport', async () => {
    const order: string[] = [];
    const coordinatorPort = new FakeCoordinatorPort();
    coordinatorPort.close = () => {
      coordinatorPort.closed = true;
      order.push('coordinator-closed');
    };
    const sharedWorker: SharedWorkerLike = {
      port: coordinatorPort as unknown as MessagePort,
      onerror: null,
    };
    const worker = new FakeWorker();
    worker.terminate = () => {
      worker.terminated = true;
      order.push('engine-terminated');
    };
    const terminalErrors: string[] = [];
    const livenessReleased = vi.fn();
    const lockManager = {
      request: vi.fn(
        async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown
        ) => {
          await callback({ name, mode: 'exclusive' } as Lock);
          livenessReleased();
        }
      ),
    } as unknown as Pick<LockManager, 'request'>;
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager,
      createSharedWorker: () => sharedWorker,
      createDedicatedWorker: () => worker,
      onTerminalError: (error) => {
        terminalErrors.push(error.message);
        order.push('terminal-reported');
      },
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    sharedWorker.onerror?.call(
      {} as AbstractWorker,
      {
        message: 'SharedWorker crashed',
        preventDefault: vi.fn(),
      } as unknown as ErrorEvent
    );

    expect(order).toEqual([
      'engine-terminated',
      'coordinator-closed',
      'terminal-reported',
    ]);
    expect(terminalErrors).toEqual(['SharedWorker crashed']);
    await vi.waitFor(() => expect(livenessReleased).toHaveBeenCalledOnce());
  });

  it('closes a standby transport on MessagePort messageerror exactly once', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const terminalErrors: string[] = [];
    const dedicatedFactory = vi.fn(() => new FakeWorker());
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: dedicatedFactory,
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;

    coordinatorPort.onmessageerror?.();
    coordinatorPort.onmessageerror?.();

    expect(dedicatedFactory).not.toHaveBeenCalled();
    expect(coordinatorPort.closed).toBe(true);
    expect(terminalErrors).toEqual([
      'coordinator Effect transport failed: Effect worker transport messageerror',
    ]);
  });

  it.each(['register-tab', 'cache-request'] as const)(
    'terminal-fails exactly once when %s send throws',
    async (throwKind) => {
      const coordinatorPort = new FakeCoordinatorPort();
      coordinatorPort.throwKinds.add(throwKind);
      const terminalErrors: string[] = [];
      const adapter = createCacheCoordinatorPageAdapter({
        scope: 'scope',
        tabId: 'tab-a',
        lockManager: heldLockManager(),
        createSharedWorker: () => ({
          port: coordinatorPort as unknown as MessagePort,
        }),
        createDedicatedWorker: () => new FakeWorker(),
        onTerminalError: (error) => terminalErrors.push(error.message),
      });
      const messages: unknown[] = [];
      adapter.onmessage = (event) => messages.push(event.data);

      if (throwKind === 'cache-request') {
        const started = adapter.start();
        await vi.waitFor(() =>
          expect(coordinatorPort.messages).toHaveLength(1)
        );
        coordinatorPort.receive({
          ...version,
          kind: 'registered',
          tabId: 'tab-a',
        });
        await started;
        adapter.postMessage({ id: 1, kind: 'clear' });
      } else {
        adapter.postMessage({ id: 1, kind: 'clear' });
        await expect(adapter.start()).rejects.toThrow(
          'register-tab send failed'
        );
        expect(messages).toEqual([
          { id: 1, ok: false, error: 'register-tab send failed' },
        ]);
      }

      await vi.waitFor(() => expect(terminalErrors).toHaveLength(1));
      coordinatorPort.onmessageerror?.();
      expect(terminalErrors).toEqual([`${throwKind} send failed`]);
      expect(coordinatorPort.closed).toBe(true);
      await adapter.dispose();
    }
  );

  it.each(['attach-engine-port', 'activate-engine'] as const)(
    'closes untransferred channels and the worker when %s send throws',
    async (throwKind) => {
      const coordinatorPort = new FakeCoordinatorPort();
      const worker = new FakeWorker();
      if (throwKind === 'attach-engine-port') {
        coordinatorPort.throwKinds.add(throwKind);
      } else {
        worker.throwOnPost = true;
      }
      const terminalErrors: string[] = [];
      const adapter = createCacheCoordinatorPageAdapter({
        scope: 'scope',
        tabId: 'tab-a',
        lockManager: heldLockManager(),
        createSharedWorker: () => ({
          port: coordinatorPort as unknown as MessagePort,
        }),
        createDedicatedWorker: () => worker,
        onTerminalError: (error) => terminalErrors.push(error.message),
      });
      const started = adapter.start();
      await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
      coordinatorPort.receive({
        ...version,
        kind: 'registered',
        tabId: 'tab-a',
      });
      await started;
      coordinatorPort.receive(election(1));

      await vi.waitFor(() => expect(terminalErrors).toHaveLength(1));
      const channel = FakeMessageChannel.instances[0];
      expect(worker.terminated).toBe(true);
      expect(channel?.port2.closed).toBe(true);
      expect(channel?.port1.closed).toBe(throwKind === 'attach-engine-port');
      expect(coordinatorPort.closed).toBe(true);
      expect(terminalErrors[0]).toContain(`${throwKind} send failed`);
    }
  );

  it('terminal-fails after terminating an engine when owner-loss reporting throws', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    coordinatorPort.throwKinds.add('engine-lost');
    const worker = new FakeWorker();
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    worker.onerror?.call(
      {} as AbstractWorker,
      {
        message: 'engine crashed',
        preventDefault: vi.fn(),
      } as unknown as ErrorEvent
    );

    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.closed).toBe(true);
    expect(terminalErrors).toEqual(['engine-lost send failed']);
  });

  it.each([
    {
      graceful: true,
      preserveDatabase: false,
      throwKind: 'graceful-departure',
    },
    {
      graceful: false,
      preserveDatabase: false,
      throwKind: 'disconnect-tab',
    },
    {
      graceful: false,
      preserveDatabase: true,
      throwKind: 'navigation-departure',
    },
  ])(
    'settles disposal when $throwKind send throws',
    async ({ graceful, preserveDatabase, throwKind }) => {
      const coordinatorPort = new FakeCoordinatorPort();
      const worker = new FakeWorker();
      const terminalErrors: string[] = [];
      const adapter = createCacheCoordinatorPageAdapter({
        scope: 'scope',
        tabId: 'tab-a',
        lockManager: heldLockManager(),
        createSharedWorker: () => ({
          port: coordinatorPort as unknown as MessagePort,
        }),
        createDedicatedWorker: () => worker,
        onTerminalError: (error) => terminalErrors.push(error.message),
      });
      const started = adapter.start();
      await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
      coordinatorPort.receive({
        ...version,
        kind: 'registered',
        tabId: 'tab-a',
      });
      await started;
      coordinatorPort.receive(election(1));
      coordinatorPort.throwKinds.add(throwKind);

      await adapter.dispose({ graceful, preserveDatabase });

      expect(worker.terminated).toBe(true);
      expect(coordinatorPort.closed).toBe(true);
      expect(terminalErrors).toEqual([`${throwKind} send failed`]);
    }
  );

  it('settles graceful timeout when disconnect reporting throws', async () => {
    vi.useFakeTimers();
    const coordinatorPort = new FakeCoordinatorPort();
    const worker = new FakeWorker();
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
      gracefulTimeoutMs: 10,
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));
    coordinatorPort.throwKinds.add('disconnect-tab');

    const disposed = adapter.dispose({ graceful: true });
    await vi.advanceTimersByTimeAsync(11);
    await disposed;

    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.closed).toBe(true);
    expect(terminalErrors).toEqual(['disconnect-tab send failed']);
  });

  it('rejects startup and queued RPC when disposed during lock acquisition', async () => {
    let allowLock!: () => void;
    const lockGate = new Promise<void>((resolve) => {
      allowLock = resolve;
    });
    const terminalErrors: string[] = [];
    const messages: unknown[] = [];
    const lockManager = {
      request: vi.fn(
        async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown
        ) => {
          await lockGate;
          await callback({ name, mode: 'exclusive' } as Lock);
          throw new Error('late lock-manager rejection');
        }
      ),
    } as unknown as Pick<LockManager, 'request'>;
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager,
      createSharedWorker: vi.fn(),
      createDedicatedWorker: () => new FakeWorker(),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    adapter.onmessage = (event) => messages.push(event.data);
    adapter.postMessage({ id: 1, kind: 'clear' });
    const started = adapter.start();

    await adapter.dispose();
    await expect(started).rejects.toThrow(
      'page adapter was disposed during startup'
    );
    expect(messages).toEqual([
      {
        id: 1,
        ok: false,
        error: 'page adapter was disposed during startup',
      },
    ]);
    allowLock();
    await Promise.resolve();
    await Promise.resolve();

    expect(terminalErrors).toEqual([]);
    await expect(adapter.start()).rejects.toThrow('page adapter is closed');
  });

  it('rejects stale elections and deduplicates replacement epochs monotonically', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const firstWorker = new FakeWorker();
    const workers = [firstWorker, new FakeWorker()];
    const dedicatedFactory = vi.fn(() => workers.shift() as FakeWorker);
    const replacements: number[] = [];
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: dedicatedFactory,
      onEngineReplaced: (epoch) => replacements.push(epoch),
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));
    coordinatorPort.receive({
      ...version,
      kind: 'engine-replaced',
      ownerEpoch: 1,
    });
    coordinatorPort.receive({
      ...version,
      kind: 'engine-replaced',
      ownerEpoch: 1,
    });
    coordinatorPort.receive({
      ...version,
      kind: 'terminate-engine',
      tabId: 'tab-a',
      ownerEpoch: 1,
      reason: 'lost',
    });
    coordinatorPort.receive(election(1));

    expect(replacements).toEqual([1]);
    expect(dedicatedFactory).toHaveBeenCalledOnce();
    expect(firstWorker.messages).toHaveLength(1);
    expect(firstWorker.messages[0]?.message).toMatchObject({
      kind: 'activate-engine',
      ownerEpoch: 1,
    });
    expect(workers).toHaveLength(1);
    expect(coordinatorPort.closed).toBe(true);
    expect(terminalErrors).toEqual([
      'coordinator elected stale or duplicate owner epoch 1',
    ]);
  });

  it('escalates an owner graceful drain to storage-preserving navigation disposal', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const worker = new FakeWorker();
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    const graceful = adapter.dispose({ graceful: true });
    expect(worker.terminated).toBe(false);
    const navigation = adapter.dispose({
      graceful: false,
      preserveDatabase: true,
    });
    expect(navigation).toBe(graceful);
    await navigation;

    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.closed).toBe(true);
    expect(
      coordinatorPort.events.filter(
        (event) => event === 'post:navigation-departure'
      )
    ).toHaveLength(1);
    expect(
      coordinatorPort.events.filter((event) => event === 'post:disconnect-tab')
    ).toHaveLength(0);
  });

  it('terminal-fails when the owned engine crashes during graceful drain', async () => {
    const coordinatorPort = new FakeCoordinatorPort();
    const worker = new FakeWorker();
    const terminalErrors: string[] = [];
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
      onTerminalError: (error) => terminalErrors.push(error.message),
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    const disposed = adapter.dispose({ graceful: true });
    worker.onerror?.call(
      {} as AbstractWorker,
      {
        message: 'engine failed while draining',
        preventDefault: vi.fn(),
      } as unknown as ErrorEvent
    );
    await disposed;

    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.closed).toBe(true);
    expect(terminalErrors).toEqual(['engine failed while draining']);
  });

  it('keeps the worker alive through graceful drain and terminates after retire-complete', async () => {
    vi.useFakeTimers();
    const coordinatorPort = new FakeCoordinatorPort();
    const worker = new FakeWorker();
    const adapter = createCacheCoordinatorPageAdapter({
      scope: 'scope',
      tabId: 'tab-a',
      lockManager: heldLockManager(),
      createSharedWorker: () => ({
        port: coordinatorPort as unknown as MessagePort,
      }),
      createDedicatedWorker: () => worker,
    });
    const started = adapter.start();
    await vi.waitFor(() => expect(coordinatorPort.messages).toHaveLength(1));
    coordinatorPort.receive({ ...version, kind: 'registered', tabId: 'tab-a' });
    await started;
    coordinatorPort.receive(election(1));

    const disposed = adapter.dispose({ graceful: true });
    expect(worker.terminated).toBe(false);
    expect(coordinatorPort.messages).toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({ kind: 'graceful-departure' }),
      })
    );
    coordinatorPort.receive({
      ...version,
      kind: 'retire-complete',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    await disposed;

    expect(worker.terminated).toBe(true);
    expect(coordinatorPort.closed).toBe(true);
  });
});
