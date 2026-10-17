// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ReplayEnvelope = { seq: number; message: unknown };
type ConnectArgs = {
  url: string;
  onMessage: { onmessage?: (envelope: ReplayEnvelope) => void };
  config?: { headers: [string, string][] };
};

const plugin = vi.hoisted(() => ({
  connects: [] as Array<{
    args: ConnectArgs;
    resolve: (id: number) => void;
    reject: (error: unknown) => void;
  }>,
  sent: [] as Array<{ id: number; message: unknown }>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage?: (envelope: ReplayEnvelope) => void;
  },
  invoke: vi.fn((command: string, args: unknown) => {
    if (command === 'plugin:websocket|connect') {
      return new Promise((resolve, reject) =>
        plugin.connects.push({ args: args as ConnectArgs, resolve, reject })
      );
    }
    if (command === 'plugin:websocket|send') {
      plugin.sent.push(args as { id: number; message: unknown });
    }
    return Promise.resolve();
  }),
}));

import { TauriWebSocketWrapper } from './tauri-websocket';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function track(socket: TauriWebSocketWrapper) {
  const events: string[] = [];
  socket.onopen = () => events.push('open');
  socket.onerror = () => events.push('error');
  socket.onclose = (event) => events.push(`close:${event.code}`);
  return events;
}

beforeEach(() => {
  plugin.connects.length = 0;
  plugin.sent.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TauriWebSocketWrapper', () => {
  it('can stand in for the WebSocket constructor', () => {
    expect(TauriWebSocketWrapper.CONNECTING).toBe(0);
    expect(TauriWebSocketWrapper.OPEN).toBe(1);
    expect(TauriWebSocketWrapper.CLOSING).toBe(2);
    expect(TauriWebSocketWrapper.CLOSED).toBe(3);
  });

  it('negotiates a single subprotocol through the handshake headers', async () => {
    const socket = new TauriWebSocketWrapper(
      'wss://dss.test/ws',
      'graphql-transport-ws'
    );
    const events = track(socket);
    expect(plugin.connects[0]?.args.config).toEqual({
      headers: [['Sec-WebSocket-Protocol', 'graphql-transport-ws']],
    });
    expect(socket.protocol).toBe('');

    plugin.connects[0]?.resolve(7);
    await settle();

    expect(events).toEqual(['open']);
    expect(socket.protocol).toBe('graphql-transport-ws');
  });

  it('sends no handshake config without a subprotocol', () => {
    new TauriWebSocketWrapper('wss://dss.test/ws');
    expect(plugin.connects[0]?.args).not.toHaveProperty('config');
  });

  it('rejects several subprotocols it cannot tell apart', () => {
    expect(
      () => new TauriWebSocketWrapper('wss://dss.test/ws', ['one', 'two'])
    ).toThrow(SyntaxError);
    expect(plugin.connects).toHaveLength(0);
  });

  it('drops a connection that completes after close()', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);

    socket.close();
    expect(socket.readyState).toBe(socket.CLOSING);
    await settle();
    expect(events).toEqual(['close:1006']);
    expect(socket.readyState).toBe(socket.CLOSED);

    plugin.connects[0]?.resolve(7);
    await settle();

    expect(events).toEqual(['close:1006']);
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(plugin.sent).toEqual([
      {
        id: 7,
        message: {
          type: 'Close',
          data: { code: 1000, reason: 'Disconnected by client' },
        },
      },
    ]);
  });

  it('reports one closure when a connect fails after close()', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);

    socket.close();
    plugin.connects[0]?.reject(new Error('unreachable'));
    await settle();

    expect(events).toEqual(['close:1006']);
  });

  it('closes with the requested code and reports it exactly once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);
    plugin.connects[0]?.resolve(7);
    await settle();

    socket.close(4499, 'Terminated');
    expect(socket.readyState).toBe(socket.CLOSING);
    await settle();

    expect(plugin.sent).toEqual([
      {
        id: 7,
        message: { type: 'Close', data: { code: 4499, reason: 'Terminated' } },
      },
    ]);
    expect(events).toEqual(['open', 'close:4499']);
    expect(socket.readyState).toBe(socket.CLOSED);
  });

  it('does not report the echo of a local close a second time', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);
    plugin.connects[0]?.resolve(7);
    await settle();

    socket.close(1000, 'Normal Closure');
    const echo = {
      type: 'Close',
      data: { code: 1000, reason: 'Normal Closure' },
    };
    plugin.connects[0]?.args.onMessage.onmessage?.({ seq: 1, message: echo });
    await settle();
    plugin.connects[0]?.args.onMessage.onmessage?.({ seq: 2, message: echo });

    expect(events).toEqual(['open', 'close:1000']);
  });

  it('reports a server-initiated closure once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);
    plugin.connects[0]?.resolve(7);
    await settle();

    const onMessage = plugin.connects[0]?.args.onMessage;
    onMessage?.onmessage?.({
      seq: 1,
      message: { type: 'Close', data: { code: 1012, reason: 'restart' } },
    });
    socket.close();
    await settle();

    expect(events).toEqual(['open', 'close:1012']);
    expect(plugin.sent).toEqual([]);
  });
});

describe('TauriWebSocketWrapper incoming messages', () => {
  async function openSocket() {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new TauriWebSocketWrapper('wss://dss.test/ws');
    const events = track(socket);
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(event.data);
    plugin.connects[0]?.resolve(7);
    await settle();
    let seq = 0;
    const channel = plugin.connects[0]!.args.onMessage;
    const push = (message: unknown) =>
      channel.onmessage?.({ seq: ++seq, message });
    const pushRaw = (payload: unknown) =>
      (channel.onmessage as (payload: unknown) => void)(payload);
    return { socket, events, received, push, pushRaw };
  }

  it('delivers text messages', async () => {
    const { received, push } = await openSocket();
    push({ type: 'Text', data: 'hello' });
    expect(received).toEqual(['hello']);
  });

  it('delivers binary messages as an ArrayBuffer', async () => {
    const { socket, received, push } = await openSocket();
    socket.binaryType = 'arraybuffer';
    push({ type: 'Binary', data: [1, 2, 3] });
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(received[0] as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it('delivers binary messages as a Blob by default', async () => {
    const { received, push } = await openSocket();
    push({ type: 'Binary', data: [1, 2, 3] });
    expect(received[0]).toBeInstanceOf(Blob);
    expect((received[0] as Blob).size).toBe(3);
  });

  it.each([
    ['a null payload', { type: 'Close', data: null }],
    ['no payload', { type: 'Close' }],
    ['a malformed payload', { type: 'Close', data: { code: 'x' } }],
  ])('closes normally on a close frame with %s', async (_label, frame) => {
    const { socket, events, push } = await openSocket();
    push(frame);
    expect(events).toEqual(['open', 'close:1000']);
    expect(socket.readyState).toBe(socket.CLOSED);
  });

  it('ignores ping and pong frames', async () => {
    const { socket, events, received, push } = await openSocket();
    push({ type: 'Ping', data: [] });
    push({ type: 'Pong', data: [1] });
    expect(events).toEqual(['open']);
    expect(received).toEqual([]);
    expect(socket.readyState).toBe(socket.OPEN);
  });

  it.each([
    'IO error: Socket is not connected (os error 57)',
    'Connection reset without closing handshake',
    'IO error: Connection reset by peer (os error 54)',
    'IO error: timed out',
  ])('fails the connection on the read error %j', async (error) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { socket, events, received, push } = await openSocket();
    let closeEvent: CloseEvent | undefined;
    socket.addEventListener('close', (event) => {
      closeEvent = event;
    });

    expect(() => push(error)).not.toThrow();
    push({ type: 'Text', data: 'after the stream ended' });

    expect(events).toEqual(['open', 'error', 'close:1006']);
    expect(closeEvent?.wasClean).toBe(false);
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(received).toEqual([]);
    expect(plugin.sent).toEqual([]);
  });

  it('reports only the local closure when a read error races close()', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { events, push, socket } = await openSocket();
    socket.close(4000, 'bye');
    push('IO error: Broken pipe (os error 32)');
    await settle();
    expect(events).toEqual(['open', 'close:4000']);
  });

  it.each([
    ['a raw frame', null],
    ['an unknown message type', { type: 'Fragment', data: [] }],
    ['a known type with a malformed payload', { type: 'Text', data: 42 }],
    ['a number', 5],
  ])('ignores %s and keeps delivering', async (_label, message) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { socket, events, received, push } = await openSocket();

    expect(() => push(message)).not.toThrow();
    push({ type: 'Text', data: 'still alive' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['open']);
    expect(received).toEqual(['still alive']);
    expect(socket.readyState).toBe(socket.OPEN);
  });

  it('accepts messages from native builds without the replay envelope', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { events, received, pushRaw } = await openSocket();
    pushRaw({ type: 'Text', data: 'bare' });
    pushRaw('IO error: Socket is not connected (os error 57)');
    expect(received).toEqual(['bare']);
    expect(events).toEqual(['open', 'error', 'close:1006']);
  });

  it('keeps delivering after a message handler throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { socket, push } = await openSocket();
    const received: unknown[] = [];
    socket.onmessage = (event) => {
      received.push(event.data);
      if (event.data === 'first') throw new Error('consumer bug');
    };

    expect(() => push({ type: 'Text', data: 'first' })).not.toThrow();
    push({ type: 'Text', data: 'second' });

    expect(received).toEqual(['first', 'second']);
  });
});
