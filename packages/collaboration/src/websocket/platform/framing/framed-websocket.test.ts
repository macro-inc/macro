import { describe, expect, test } from 'vitest';
import { framedWebSocketFactory } from './framed-websocket';
import type { MinimalWebSocket } from '../minimal-websocket';

type MockWebSocket = MinimalWebSocket & {
  /** Payloads passed to `send`, in order. */
  readonly sent: (string | ArrayBufferLike | Blob | ArrayBufferView)[];
  /** Fire a 'message' event to registered listeners, as the real socket would. */
  emit(data: string | ArrayBuffer): void;
};

function createMockWebSocket(): MockWebSocket {
  const listeners = new Set<EventListener>();
  const sent: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

  return {
    binaryType: 'arraybuffer',
    bufferedAmount: 0,
    extensions: '',
    protocol: '',
    readyState: 1,
    url: 'ws://test',
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.add(listener as EventListener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') listeners.delete(listener as EventListener);
    },
    dispatchEvent: () => true,
    close: () => {},
    send: (data) => {
      sent.push(data);
    },
    sent,
    emit: (data) => {
      const event = new MessageEvent('message', { data });
      listeners.forEach((listener) => listener(event));
    },
  };
}

/** Wraps a mock socket in a FramedWebSocket via the public factory. */
function framedOver(mock: MockWebSocket) {
  return framedWebSocketFactory(() => mock)('ws://test');
}

describe('FramedWebSocket', () => {
  test('frames outbound binary messages', () => {
    const mock = createMockWebSocket();
    framedOver(mock).send(new Uint8Array([9, 8, 7]));

    expect(mock.sent.length).toBe(1);
    const frame = mock.sent[0] as Uint8Array;
    expect(frame[0]).toBe(1); // isFinal
    expect(Array.from(frame.subarray(1))).toEqual([9, 8, 7]);
  });

  test('passes outbound strings through unframed', () => {
    const mock = createMockWebSocket();
    framedOver(mock).send('ping');
    expect(mock.sent).toEqual(['ping']);
  });

  test('reassembles a single inbound binary frame', () => {
    const mock = createMockWebSocket();
    const ws = framedOver(mock);
    const received: number[][] = [];
    ws.addEventListener('message', (e) =>
      received.push(Array.from(new Uint8Array((e as MessageEvent).data)))
    );

    mock.emit(new Uint8Array([1, 5, 6]).buffer); // isFinal, payload [5,6]

    expect(received).toEqual([[5, 6]]);
  });

  test('dispatches once after the final frame of a multi-frame message', () => {
    const mock = createMockWebSocket();
    const ws = framedOver(mock);
    const received: number[][] = [];
    ws.addEventListener('message', (e) =>
      received.push(Array.from(new Uint8Array((e as MessageEvent).data)))
    );

    mock.emit(new Uint8Array([0, 1, 2]).buffer);
    mock.emit(new Uint8Array([1, 3]).buffer);

    expect(received).toEqual([[1, 2, 3]]);
  });

  test('passes inbound strings (pong) straight through', () => {
    const mock = createMockWebSocket();
    const ws = framedOver(mock);
    const received: unknown[] = [];
    ws.addEventListener('message', (e) =>
      received.push((e as MessageEvent).data)
    );

    mock.emit('pong');

    expect(received).toEqual(['pong']);
  });
});
