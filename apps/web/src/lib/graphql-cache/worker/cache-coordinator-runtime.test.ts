import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';
import { installCacheCoordinatorWorker } from './cache-coordinator-runtime';
import type { CoordinatorToTabEnvelope } from './coordinator-protocol';
import type {
  CoordinatorMessagePort,
  CoordinatorRouter,
} from './coordinator-router';
import {
  EFFECT_WORKER_REQUEST_TAG,
  EFFECT_WORKER_RESPONSE_TAG,
} from './effect-worker-transport';

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
  coordinatorVersion: 2,
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
        coordinatorVersion: 2,
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
});
