import * as Effect from 'effect/Effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installCacheCoordinatorWorker,
  installSharedCacheCoordinatorWorker,
} from './cache-coordinator-runtime';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  type CoordinatorToTabEnvelope,
  type TabToCoordinatorEnvelope,
} from './coordinator-protocol';
import type {
  CoordinatorMessagePort,
  CoordinatorRouter,
} from './coordinator-router';
import {
  EFFECT_WORKER_CLOSE_FRAME,
  EFFECT_WORKER_REQUEST_TAG,
  EFFECT_WORKER_RESPONSE_TAG,
} from './effect-worker-transport';

type SharedWorkerScope = Parameters<
  typeof installSharedCacheCoordinatorWorker
>[0];

class FakeEndpoint extends EventTarget {
  readonly sent: unknown[] = [];
  failOutbound = false;
  closed = false;

  postMessage(message: unknown): void {
    if (
      this.failOutbound &&
      Array.isArray(message) &&
      message[0] === EFFECT_WORKER_RESPONSE_TAG &&
      message.length > 1
    ) {
      throw new Error('outbound send failed');
    }
    this.sent.push(message);
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }

  receive(message: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: [EFFECT_WORKER_REQUEST_TAG, message],
      })
    );
  }
}

const message = {
  coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
  kind: 'disconnect-tab',
  tabId: 'tab-a',
  reason: 'test',
} as const;

const setup = () => {
  const endpoint = new FakeEndpoint();
  const ports: CoordinatorMessagePort[] = [];
  const connect = vi.fn((port: CoordinatorMessagePort) => {
    ports.push(port);
  });
  const runner = installCacheCoordinatorWorker({
    endpoint: endpoint as unknown as MessagePort,
    router: { connect } as unknown as CoordinatorRouter,
  });
  return { connect, endpoint, ports, runner };
};

describe('cache coordinator runtime', () => {
  it('does not recreate a port after the router closes it', async () => {
    const { connect, endpoint, ports, runner } = setup();
    endpoint.receive(message);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());

    ports[0]?.close();
    endpoint.receive(message);
    await Promise.resolve();

    expect(connect).toHaveBeenCalledOnce();
    await Effect.runPromise(runner.close());
  });

  it('closes a lost client runner while another client remains usable', async () => {
    const ports: CoordinatorMessagePort[] = [];
    const received = vi.fn();
    const router = {
      connect(port: CoordinatorMessagePort) {
        ports.push(port);
        port.onmessage = received;
      },
    } as unknown as CoordinatorRouter;
    const first = new FakeEndpoint();
    const second = new FakeEndpoint();
    const firstRunner = installCacheCoordinatorWorker({
      endpoint: first as unknown as MessagePort,
      router,
    });
    const secondRunner = installCacheCoordinatorWorker({
      endpoint: second as unknown as MessagePort,
      router,
    });
    first.receive(message);
    second.receive(message);
    await vi.waitFor(() => expect(ports).toHaveLength(2));
    ports[0].close();
    await vi.waitFor(() => expect(first.closed).toBe(true));
    expect(firstRunner.isClosed()).toBe(true);
    expect(second.closed).toBe(false);
    second.receive(message);
    expect(received).toHaveBeenCalledTimes(3);
    await Effect.runPromise(secondRunner.close());
  });

  it('contains failed sends and leaves the closed port terminal', async () => {
    const { connect, endpoint, ports, runner } = setup();
    const onmessageerror = vi.fn();
    connect.mockImplementation((port: CoordinatorMessagePort) => {
      ports.push(port);
      port.onmessageerror = onmessageerror;
    });
    endpoint.receive(message);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    endpoint.failOutbound = true;

    expect(() =>
      ports[0]?.postMessage({
        coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
        kind: 'protocol-error',
        error: 'test',
      } satisfies CoordinatorToTabEnvelope)
    ).not.toThrow();
    expect(onmessageerror).toHaveBeenCalledOnce();

    endpoint.receive(message);
    await Promise.resolve();
    expect(connect).toHaveBeenCalledOnce();
    await Effect.runPromise(runner.close());
  });

  it('lets the router answer a message that could not be read', async () => {
    const { connect, endpoint, ports, runner } = setup();
    connect.mockImplementation((port: CoordinatorMessagePort) => {
      ports.push(port);
      port.onmessageerror = () => {
        port.postMessage({
          coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
          kind: 'connection-closed',
          reason: 'test',
        } satisfies CoordinatorToTabEnvelope);
        port.close();
      };
    });
    endpoint.receive(message);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    const closedBeforeSend: boolean[] = [];
    const post = endpoint.postMessage.bind(endpoint);
    endpoint.postMessage = (sent) => {
      closedBeforeSend.push(endpoint.closed);
      post(sent);
    };

    endpoint.dispatchEvent(new MessageEvent('messageerror'));

    await vi.waitFor(() => expect(endpoint.closed).toBe(true));
    expect(closedBeforeSend).toEqual([false]);
    expect(endpoint.sent.at(-1)).toEqual([
      EFFECT_WORKER_RESPONSE_TAG,
      expect.objectContaining({ kind: 'connection-closed' }),
    ]);
    await Effect.runPromise(runner.close());
  });
});

describe('shared coordinator client retirement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts a new client after the last client closes and releases router state', async () => {
    const disconnected = vi.fn();
    const connect = vi.fn((port: CoordinatorMessagePort) => {
      port.onmessageerror = disconnected;
    });
    const scope: SharedWorkerScope = { onconnect: null, close: vi.fn() };
    installSharedCacheCoordinatorWorker(scope, {
      connect,
    } as unknown as CoordinatorRouter);
    for (let index = 0; index < 3; index++) {
      const endpoint = new FakeEndpoint();
      scope.onconnect?.({ ports: [endpoint] } as unknown as MessageEvent);
      endpoint.receive(message);
      await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(index + 1));
      endpoint.dispatchEvent(
        new MessageEvent('message', { data: EFFECT_WORKER_CLOSE_FRAME })
      );
      await vi.waitFor(() =>
        expect(disconnected).toHaveBeenCalledTimes(index + 1)
      );
      expect(endpoint.closed).toBe(true);
    }
    expect(scope.close).not.toHaveBeenCalled();
  });

  it('closes the worker when a newer coordinator of the build runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown
        ) => callback(null),
        query: async () => ({
          held: [{ name: 'graphql-cache-coordinator:scope:0:7:other' }],
        }),
      },
    });
    const scope: SharedWorkerScope = { onconnect: null, close: vi.fn() };
    installSharedCacheCoordinatorWorker(scope);
    const endpoint = new FakeEndpoint();
    scope.onconnect?.({ ports: [endpoint] } as unknown as MessageEvent);
    endpoint.receive({
      coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
      kind: 'register-tab',
      scope: 'scope',
      tabId: 'tab',
      livenessLockName: 'graphql-cache-tab:scope:tab',
      visible: true,
      buildTime: 0,
    } as TabToCoordinatorEnvelope);

    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledOnce());
    expect(endpoint.sent.at(-1)).toEqual([
      EFFECT_WORKER_RESPONSE_TAG,
      expect.objectContaining({ kind: 'connection-closed' }),
    ]);
  });
});
