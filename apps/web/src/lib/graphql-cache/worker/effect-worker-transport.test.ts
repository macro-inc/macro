import { describe, expect, it, vi } from 'vitest';
import { createEffectWorkerTransport } from './effect-worker-transport';

class FakeMessagePort extends EventTarget {
  readonly sent: Array<{
    message: unknown;
    transfers: readonly Transferable[] | undefined;
  }> = [];

  postMessage(
    message: unknown,
    transfers?: readonly Transferable[] | StructuredSerializeOptions
  ): void {
    this.sent.push({
      message,
      transfers: Array.isArray(transfers)
        ? transfers
        : (transfers as StructuredSerializeOptions | undefined)?.transfer,
    });
  }

  start(): void {}

  close(): void {}

  ready(): void {
    this.dispatchEvent(new MessageEvent('message', { data: [0] }));
  }

  emit(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: [1, message] }));
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Effect worker transport', () => {
  it('buffers sends until ready and preserves their order', async () => {
    const endpoint = new FakeMessagePort();
    const received: unknown[] = [];
    const transport = createEffectWorkerTransport<unknown, string>({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: (message) => received.push(message),
      onError: vi.fn(),
    });

    await transport.send('first');
    await transport.send('second');
    expect(endpoint.sent).toEqual([]);

    endpoint.ready();
    await transport.ready;
    expect(endpoint.sent.map(({ message }) => message)).toEqual([
      [0, 'first'],
      [0, 'second'],
    ]);

    endpoint.emit({ kind: 'response' });
    await flush();
    expect(received).toEqual([{ kind: 'response' }]);

    await transport.close();
  });

  it('passes transferables and emits the Effect close frame once', async () => {
    const endpoint = new FakeMessagePort();
    const closeEndpoint = vi.fn();
    const transport = createEffectWorkerTransport<unknown, unknown>({
      endpoint: endpoint as unknown as MessagePort,
      onMessage: vi.fn(),
      onError: vi.fn(),
      closeEndpoint,
    });
    endpoint.ready();
    await transport.ready;

    const channel = new MessageChannel();
    await transport.send({ port: channel.port1 }, [channel.port1]);
    const framed = endpoint.sent[0]?.message as
      | [number, { port: MessagePort }]
      | undefined;
    expect(framed?.[0]).toBe(0);
    expect(framed?.[1].port).toBe(channel.port1);
    expect(endpoint.sent[0]?.transfers).toHaveLength(1);
    expect(endpoint.sent[0]?.transfers?.[0]).toBe(channel.port1);

    await Promise.all([transport.close(), transport.close()]);
    expect(endpoint.sent.at(-1)?.message).toEqual([1]);
    expect(
      endpoint.sent.filter(({ message }) =>
        Array.isArray(message) ? message[0] === 1 : false
      )
    ).toHaveLength(1);
    expect(closeEndpoint).toHaveBeenCalledOnce();
    channel.port2.close();
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
      expect.objectContaining({ message: 'Effect worker transport messageerror' })
    );

    await transport.close();
    await expect(transport.send({ kind: 'late' })).rejects.toThrow(
      'Effect worker transport is closed'
    );
  });
});
