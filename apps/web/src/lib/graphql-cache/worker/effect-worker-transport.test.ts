import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';
import {
  createEffectWorkerRunnerTransport,
  createEffectWorkerTransport,
  EFFECT_WORKER_CLOSE_FRAME,
  EFFECT_WORKER_READY_FRAME,
  EFFECT_WORKER_REQUEST_TAG,
  EFFECT_WORKER_RESPONSE_TAG,
} from './effect-worker-transport';

class FakeMessagePort extends EventTarget {
  readonly sent: Array<{
    message: unknown;
    transfers: readonly Transferable[] | undefined;
  }> = [];
  closed = false;

  postMessage(
    message: unknown,
    transfers?: readonly Transferable[] | StructuredSerializeOptions
  ): void {
    if (this.closed) return;
    this.sent.push({
      message,
      transfers: Array.isArray(transfers)
        ? transfers
        : (transfers as StructuredSerializeOptions | undefined)?.transfer,
    });
    this.dispatchEvent(new Event('sent'));
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }

  ready(): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: EFFECT_WORKER_READY_FRAME })
    );
  }

  emit(message: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: [EFFECT_WORKER_RESPONSE_TAG, message],
      })
    );
  }
}

// Effect resumes fibers with setImmediate under Node, which can fire after a
// setTimeout(0) (including the one that resolves `ready`), so assertions on
// delivered frames wait for them instead of assuming one timer tick suffices.
describe('Effect worker transport', () => {
  it('buffers sends until ready and preserves their order', async () => {
    const endpoint = new FakeMessagePort();
    const received: unknown[] = [];
    const transport = createEffectWorkerTransport<unknown, string>({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: (message) => received.push(message),
      onError: vi.fn(),
    });

    await Effect.runPromise(transport.send('first'));
    await Effect.runPromise(transport.send('second'));
    expect(endpoint.sent).toEqual([]);

    endpoint.ready();
    await transport.ready;
    await vi.waitFor(() =>
      expect(endpoint.sent.map(({ message }) => message)).toEqual([
        [EFFECT_WORKER_REQUEST_TAG, 'first'],
        [EFFECT_WORKER_REQUEST_TAG, 'second'],
      ])
    );

    endpoint.emit({ kind: 'response' });
    await vi.waitFor(() => expect(received).toEqual([{ kind: 'response' }]));

    await Effect.runPromise(transport.close());
  });

  it('reports a restarted runner on an already-ready port', async () => {
    const endpoint = new FakeMessagePort();
    const onError = vi.fn();
    const transport = createEffectWorkerTransport({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: vi.fn(),
      onError,
    });
    try {
      endpoint.ready();
      await transport.ready;
      endpoint.ready();
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'WorkerRestartedError' })
      );
    } finally {
      await Effect.runPromise(transport.close());
    }
  });

  it('rejects startup when a second ready frame arrives before readiness settles', async () => {
    const endpoint = new FakeMessagePort();
    const transport = createEffectWorkerTransport({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: vi.fn(),
      onError: vi.fn(),
    });
    const rejected = expect(transport.ready).rejects.toMatchObject({
      name: 'WorkerRestartedError',
    });
    endpoint.ready();
    endpoint.ready();
    await rejected;
    await Effect.runPromise(transport.close());
  });

  it('does not start its protocol fiber when listener setup fails', () => {
    const endpoint = new FakeMessagePort();
    const addEventListener = endpoint.addEventListener.bind(endpoint);
    vi.spyOn(endpoint, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'messageerror') {
          throw new Error('listener setup failed');
        }
        addEventListener(type, listener, options);
      }
    );
    const onError = vi.fn();

    expect(() =>
      createEffectWorkerTransport({
        endpoint: endpoint as unknown as MessagePort,
        onMessage: vi.fn(),
        onError,
      })
    ).toThrow('listener setup failed');
    endpoint.ready();
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes transferables and emits the Effect close frame once', async () => {
    const endpoint = new FakeMessagePort();
    const closeEndpoint = vi.fn();
    const transport = createEffectWorkerTransport<unknown, unknown>({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: vi.fn(),
      onError: vi.fn(),
      closeEndpoint: () => {
        closeEndpoint();
        endpoint.close();
      },
    });
    endpoint.ready();
    await transport.ready;

    const channel = new MessageChannel();
    const sent = new Promise<void>((resolve) => {
      endpoint.addEventListener('sent', () => resolve(), { once: true });
    });
    await Effect.runPromise(
      transport.send({ port: channel.port1 }, [channel.port1])
    );
    await sent;
    const framed = endpoint.sent[0]?.message as
      | [number, { port: MessagePort }]
      | undefined;
    expect(framed?.[0]).toBe(EFFECT_WORKER_REQUEST_TAG);
    expect(framed?.[1].port).toBe(channel.port1);
    expect(endpoint.sent[0]?.transfers).toHaveLength(1);
    expect(endpoint.sent[0]?.transfers?.[0]).toBe(channel.port1);

    await Effect.runPromise(
      Effect.all([transport.close(), transport.close()], { discard: true })
    );
    expect(endpoint.sent.at(-1)?.message).toEqual(EFFECT_WORKER_CLOSE_FRAME);
    expect(
      endpoint.sent.filter(({ message }) =>
        Array.isArray(message)
          ? message[0] === EFFECT_WORKER_RESPONSE_TAG
          : false
      )
    ).toHaveLength(1);
    expect(closeEndpoint).toHaveBeenCalledOnce();
    channel.port2.close();
  });

  it('communicates with the Effect runner over a MessagePort', async () => {
    const channel = new MessageChannel();
    const parentMessages: unknown[] = [];
    let runnerPortId: number | undefined;
    let runnerMessage: unknown;
    const runner = createEffectWorkerRunnerTransport<unknown, unknown>({
      endpoint: channel.port2,
      onMessage(portId, message) {
        runnerPortId = portId;
        runnerMessage = message;
      },
      onError: vi.fn(),
    });
    const parent = createEffectWorkerTransport<unknown, unknown>({
      endpoint: channel.port1,
      onMessage: (message) => parentMessages.push(message),
      onError: vi.fn(),
    });

    await parent.ready;
    Effect.runSync(parent.send({ kind: 'request' }));
    await vi.waitFor(() => expect(runnerMessage).toEqual({ kind: 'request' }));
    expect(runnerPortId).toBe(0);

    Effect.runSync(runner.send(0, { kind: 'response' }));
    await vi.waitFor(() =>
      expect(parentMessages).toEqual([{ kind: 'response' }])
    );

    await Effect.runPromise(
      Effect.all([parent.close(), runner.close()], { discard: true })
    );
  });

  it('reports message decoding failures and rejects sends after close', async () => {
    const endpoint = new FakeMessagePort();
    const onError = vi.fn();
    const transport = createEffectWorkerTransport<unknown, unknown>({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: vi.fn(),
      onError,
    });
    endpoint.ready();
    await transport.ready;

    endpoint.dispatchEvent(
      new MessageEvent('messageerror', { data: 'uncloneable response' })
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Effect worker transport messageerror',
      })
    );

    await Effect.runPromise(transport.close());
    await expect(
      Effect.runPromise(transport.send({ kind: 'late' }))
    ).rejects.toThrow('Effect worker transport is closed');
  });
});
