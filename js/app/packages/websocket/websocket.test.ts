import { Server as MockServer } from 'mock-socket';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bebopPlugin,
  createDurableSocket,
  createWebsocketEventEffect,
  createWebsocketEventEffects,
  heartbeatPlugin,
  jsonPlugin,
} from '.';

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

const HANDSHAKE_DELAY = 100;
const handshake = () => advance(HANDSHAKE_DELAY);

const now = () => Date.now();

const getRandomPort = () =>
  Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;

const getMockServer = (port?: number): [string, MockServer] => {
  const wsPort = port ?? getRandomPort();
  const url = `ws://localhost:${wsPort}`;
  return [url, new MockServer(url)];
};

beforeEach(() => {
  vi.useFakeTimers();

  // Polyfill Blob.arrayBuffer method for mock-socket compatibility
  // mock-socket 9.3.1 creates Blob objects without the arrayBuffer() method,
  // which causes bebopPlugin to fail. This polyfill ensures the test can run.
  const OriginalBlob = globalThis.Blob;
  if (OriginalBlob && !OriginalBlob.prototype.arrayBuffer) {
    OriginalBlob.prototype.arrayBuffer = async function () {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDurableSocket', () => {
  it('should connect immediately', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const ws = createDurableSocket(url);
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      await handshake();
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(server.clients().length).toBe(1);
      dispose();
    });
  });

  it('should reconnect after close', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;
      server.on('connection', () => connectionCount++);

      createDurableSocket(url);
      await handshake();

      expect(connectionCount).toBe(1);

      server.clients()[0].close();
      await advance(3000);

      expect(connectionCount).toBe(2);
      dispose();
    });
  });

  it('should try to reconnect on server failure', async () => {
    await createRoot(async (dispose) => {
      const port = getRandomPort();
      // Initialize the server
      const [url, server] = getMockServer(port);
      let ws = createDurableSocket(url);
      await handshake();

      expect(ws.readyState).toBe(WebSocket.OPEN);

      // close the server
      server.close();

      await advance(100);
      // Should have disconnected
      expect(ws.readyState).toBe(WebSocket.CLOSED);

      // Let the websocket try and fail to reconnect
      // several times, simulating a server being down
      await advance(10_000);

      // Bring the server back up
      getMockServer(port);

      // give it some time
      await advance(10000);

      // Should have reconnected
      expect(ws.readyState).toBe(WebSocket.OPEN);
      dispose();
    });
  });

  it('should queue messages sent before open', async () => {
    await createRoot(async (dispose) => {
      const messages: string[] = [];
      const [url, server] = getMockServer();
      server.on('connection', (s) =>
        s.on('message', (d) => messages.push(d as string))
      );

      const ws = createDurableSocket(url);

      ws.send('message1');
      ws.send('message2');

      await handshake();
      await advance(50);
      expect(messages).toEqual(['message1', 'message2']);
      dispose();
    });
  });

  it('should resolve URL with async resolver', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;
      server.on('connection', () => connectionCount++);

      const urlResolver = async () => {
        await advance(50);
        return `${url}?count=${connectionCount}`;
      };

      createDurableSocket(url, { reconnectUrlResolver: urlResolver });

      await advance(300);
      expect(connectionCount).toBe(1);

      server.clients()[0].close();
      await advance(3000);
      expect(connectionCount).toBe(2);
      expect(server.clients()[0].url).toBe(`${url}/?count=1`);
      dispose();
    });
  });

  it('should reconnect correctly several times, with variable delay', async () => {
    await createRoot(async (dispose) => {
      const delays = [10, 50, 100, 500, 1000, 10_000];

      for (const delay of delays) {
        const [url, server] = getMockServer();
        let connectionCount = 0;
        server.on('connection', () => connectionCount++);

        const iterations = 50;

        createDurableSocket(url, {
          delay,
          retries: Infinity,
        });
        await handshake();

        expect(connectionCount).toBe(1);

        for (let i = 0; i < iterations; i++) {
          server.clients().forEach((c) => c.close());
          await advance(delay + 100);
          expect(connectionCount).toBe(i + 2);
        }
      }

      dispose();
    });
  });

  it('should suppress duplicate reconnect attempts when many errors arrive together', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connections = 0;
      server.on('connection', (s) => {
        connections++;
        // flood error/close events
        s.dispatchEvent(new Event('error'));
        s.dispatchEvent(new Event('error'));
        s.close();
        s.close();
      });

      createDurableSocket(url);
      await advance(1_000);

      expect(connections).toBe(2);
      dispose();
    });
  });
});

describe('heartbeatPlugin', () => {
  it('sends ping / receives pong', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const messages: string[] = [];

      server.on('connection', (s) =>
        s.on('message', (d) => {
          messages.push(d as string);
          if (d === 'ping') s.send('pong');
        })
      );

      createDurableSocket(url, undefined, [
        heartbeatPlugin({ interval: 100, wait: 50 }),
      ]);
      await advance(150);
      expect(messages).toContain('ping');
      dispose();
    });
  });

  it('reconnects when pong missing', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;
      server.on('connection', () => connectionCount++);

      createDurableSocket(url, undefined, [
        heartbeatPlugin({ interval: 100, wait: 50 }),
      ]);
      await advance(400);
      expect(connectionCount).toBeGreaterThan(1);
      dispose();
    });
  });

  it('resets heartbeat on user activity', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const pings: number[] = [];
      let lastPing = 0;

      server.on('connection', (s) =>
        s.on('message', (d) => {
          if (d === 'ping') {
            pings.push(now() - lastPing);
            lastPing = now();
            s.send('pong');
          }
        })
      );

      const ws = createDurableSocket(url, undefined, [
        heartbeatPlugin({ interval: 100, wait: 50 }),
      ]);

      await advance(50);
      ws.send('user message'); // resets timer

      await advance(150);
      expect(pings.length).toBeGreaterThan(0);
      dispose();
    });
  });

  it('does not reconnect when heartbeat is healthy', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;

      server.on('connection', (socket) => {
        connectionCount++;
        socket.on('message', (d) => {
          if (d === 'ping') socket.send('pong');
        });
      });

      createDurableSocket(url, undefined, [
        heartbeatPlugin({ interval: 100, wait: 100 }),
      ]);

      await handshake();
      expect(connectionCount).toBe(1);

      await advance(60_000);

      expect(connectionCount).toBe(1);

      dispose();
    });
  }, 60_000);

  it('reconnects on missing pong with interval === wait', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;
      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        heartbeatPlugin({ interval: 100, wait: 100 }),
        jsonPlugin(),
      ]);

      setInterval(() => {
        ws.send('random');
      }, 90);

      server.on('connection', (_) => {
        connectionCount++;
      });

      await handshake();

      await advance(1000);

      expect(connectionCount).greaterThan(1);
      ws.close();
      dispose();
    });
  });

  it('reconnects only once with delayed pong', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      let connectionCount = 0;
      let pongEnabled = false;

      server.on('connection', (socket) => {
        connectionCount++;
        socket.on('message', (d) => {
          if (pongEnabled && d === 'ping') socket.send('pong');
        });
      });

      createDurableSocket(url, undefined, [
        heartbeatPlugin({ interval: 500, wait: 500 }),
      ]);

      // Need to wait slightly longer than the interval to ensure the heartbeat is sent
      // and then the pong is not received.
      await advance(1100);
      pongEnabled = true;
      expect(connectionCount).toBe(2);

      await advance(2000);
      expect(connectionCount).toBe(2);
      dispose();
    });
  });
});

describe('createWebsocketEventEffect', () => {
  it('should call callback only for messages with matching type', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const callback = vi.fn();

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      createWebsocketEventEffect(ws, 'user_update', callback);

      await handshake();

      // Send message with matching type
      server.clients()[0].send(
        JSON.stringify({
          type: 'user_update',
          data: { id: 1, name: 'Alice' },
        })
      );

      // Send message with different type
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'other_event', data: { foo: 'bar' } }));

      await advance(50);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        type: 'user_update',
        data: { id: 1, name: 'Alice' },
      });

      dispose();
    });
  });

  it('should handle multiple event effects on the same socket', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const userCallback = vi.fn();
      const uploadCallback = vi.fn();

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      createWebsocketEventEffect(ws, 'user_update', userCallback);
      createWebsocketEventEffect(ws, 'bulk_upload', uploadCallback);

      await handshake();

      server
        .clients()[0]
        .send(JSON.stringify({ type: 'user_update', data: { id: 1 } }));
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'bulk_upload', data: { count: 100 } }));

      await advance(50);

      expect(userCallback).toHaveBeenCalledTimes(1);
      expect(userCallback).toHaveBeenCalledWith({
        type: 'user_update',
        data: { id: 1 },
      });

      expect(uploadCallback).toHaveBeenCalledTimes(1);
      expect(uploadCallback).toHaveBeenCalledWith({
        type: 'bulk_upload',
        data: { count: 100 },
      });

      dispose();
    });
  });

  it('should cleanup event listeners on disposal', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const callback = vi.fn();

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      const innerDispose = createRoot((innerDispose) => {
        createWebsocketEventEffect(ws, 'test_event', callback);
        return innerDispose;
      });

      await handshake();

      // Send message before disposal
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'test_event', data: { before: true } }));

      await advance(50);
      expect(callback).toHaveBeenCalledTimes(1);

      // Dispose the effect
      innerDispose();

      // Send message after disposal
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'test_event', data: { after: true } }));

      await advance(50);
      // Should still be called only once
      expect(callback).toHaveBeenCalledTimes(1);

      dispose();
    });
  });

  it('should work with raw websocket without jsonPlugin', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const callback = vi.fn();

      const ws = createDurableSocket(url);

      createWebsocketEventEffect(ws, 'test', callback);

      await handshake();

      // Send raw string that's not JSON
      server.clients()[0].send('not json');

      await advance(50);

      // Should not be called for non-object messages
      expect(callback).not.toHaveBeenCalled();

      dispose();
    });
  });

  it('should ignore messages without type field', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const callback = vi.fn();

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      createWebsocketEventEffect(ws, 'test_event', callback);

      await handshake();

      // Send message without type field
      server.clients()[0].send(JSON.stringify({ data: 'no type field' }));

      await advance(50);

      expect(callback).not.toHaveBeenCalled();

      dispose();
    });
  });
});

describe('createWebsocketEventEffects', () => {
  it('should register multiple event handlers at once', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const handlers = {
        user_update: vi.fn(),
        bulk_upload: vi.fn(),
        notification: vi.fn(),
      };

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      createWebsocketEventEffects(ws, handlers);

      await handshake();

      // Send different event types
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'user_update', data: { id: 1 } }));
      server
        .clients()[0]
        .send(JSON.stringify({ type: 'bulk_upload', data: { count: 50 } }));
      server
        .clients()[0]
        .send(
          JSON.stringify({ type: 'notification', data: { message: 'Hello' } })
        );

      await advance(50);

      expect(handlers.user_update).toHaveBeenCalledWith({
        type: 'user_update',
        data: { id: 1 },
      });
      expect(handlers.bulk_upload).toHaveBeenCalledWith({
        type: 'bulk_upload',
        data: { count: 50 },
      });
      expect(handlers.notification).toHaveBeenCalledWith({
        type: 'notification',
        data: { message: 'Hello' },
      });

      dispose();
    });
  });

  it('should handle empty handlers object', async () => {
    await createRoot(async (dispose) => {
      const [url] = getMockServer();
      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      // Should not throw
      expect(() => {
        createWebsocketEventEffects(ws, {});
      }).not.toThrow();

      dispose();
    });
  });
});

describe('bebopPlugin', () => {
  it('serialises & deserialises messages', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const mockSend = {
        encode: (d: { text: string }) =>
          new Uint8Array(new TextEncoder().encode(d.text)),
      };
      const mockRecv = {
        decode: (d: Uint8Array) => ({ text: new TextDecoder().decode(d) }),
      };

      let receivedOnClient: any;
      let receivedOnServer: any;

      server.on('connection', (s) =>
        s.on('message', (d) => {
          receivedOnServer = d;
          s.send(new Blob([new TextEncoder().encode('server response')]));
        })
      );

      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        bebopPlugin(mockSend, mockRecv),
      ]);

      await advance(100);
      ws.addEventListener('message', (e) => {
        receivedOnClient = e.data;
      });

      ws.send({ text: 'client message' });
      await advance(500);

      expect(receivedOnServer).toBeInstanceOf(Uint8Array);
      expect(receivedOnClient).toEqual({ text: 'server response' });
      dispose();
    });
  });

  it('keeps serialisation after reconnect', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const mockSend = {
        encode: (d: { id: number }) => new Uint8Array([d.id]),
      };
      const mockRecv = { decode: (d: Uint8Array) => ({ id: d[0] }) };

      const messages: any[] = [];
      server.on('connection', (s) => s.on('message', (d) => messages.push(d)));

      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        bebopPlugin(mockSend, mockRecv),
      ]);

      await advance(100);
      ws.send({ id: 1 });

      server.clients()[0].close(); // force reconnect
      await advance(100);
      ws.send({ id: 2 });

      await advance(100);
      expect(messages).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
      dispose();
    });
  });

  it('is consistent through 50 reconnects', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const mockSend = {
        encode: (d: { id: number }) => new Uint8Array([d.id]),
      };
      const mockRecv = { decode: (d: Uint8Array) => ({ id: d[0] }) };

      const messages: any[] = [];
      server.on('connection', (s) => s.on('message', (d) => messages.push(d)));

      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        bebopPlugin(mockSend, mockRecv),
      ]);

      await advance(100);

      for (let i = 0; i < 50; i++) {
        server.clients().forEach((c) => c.close());
        await advance(100);

        ws.send({ id: i });
        await advance(100);

        expect(messages.filter((m) => m !== 'ping').at(-1)).toEqual(
          new Uint8Array([i])
        );
      }

      ws.close();
      dispose();
    });
  });

  it('remains consistent with heartbeat through 50 reconnects', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const mockSend = {
        encode: (d: { id: number }) => new Uint8Array([d.id]),
      };
      const mockRecv = { decode: (d: Uint8Array) => ({ id: d[0] }) };

      const messages: any[] = [];
      server.on('connection', (s) =>
        s.on('message', (d) => {
          if (d === 'ping') s.send('pong');
          messages.push(d);
        })
      );

      const ws = createDurableSocket(url, { delay: 100, retries: 2 }, [
        heartbeatPlugin({ interval: 3000, wait: 1000 }),
        bebopPlugin(mockSend, mockRecv),
      ]);

      await advance(100);

      for (let i = 0; i < 50; i++) {
        server.clients().forEach((c) => c.close());
        await advance(100);

        ws.send({ id: i });
        await advance(100);

        expect(messages.filter((m) => m !== 'ping').at(-1)).toEqual(
          new Uint8Array([i])
        );
      }

      ws.close();
      dispose();
    });
  });
});

describe('jsonPlugin', () => {
  it('should serialize messages on send', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const payload = { a: 1, b: 'x' };

      let receivedServerMessage: any;

      server.on('connection', (sock) => {
        sock.on('message', (data) => {
          if (data !== 'ping') receivedServerMessage = data;
        });
      });

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      await handshake();

      ws.send(payload);

      await advance(10);

      expect(receivedServerMessage).toBe(JSON.stringify(payload));

      ws.close();
      server.close();
      dispose();
    });
  });

  it('should deserialize messages on receive', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();
      const inbound = { hello: 'world' };

      const ws = createDurableSocket(url, undefined, [jsonPlugin()]);

      let receivedClientMessage: any;

      ws.addEventListener('message', (e) => {
        receivedClientMessage = e.data;
      });

      await handshake();

      server.clients().forEach((c) => c.send(JSON.stringify(inbound)));

      await advance(10);

      expect(receivedClientMessage).toEqual(inbound);

      server.close();

      dispose();
    });
  });

  it('passes non-JSON strings through untouched', async () => {
    const [url, server] = getMockServer();

    let receivedMessage;
    server.on('connection', (sock) => {
      sock.send('pong');
    });

    const ws = createDurableSocket(url, undefined, [jsonPlugin()]);
    ws.addEventListener('message', (e) => {
      receivedMessage = e.data;
    });

    await handshake();

    expect(receivedMessage).toBe('pong');

    server.close();
  });

  it('passes binary/Blob frames through untouched', async () => {
    const [url, server] = getMockServer();
    const buf = new Uint8Array([1, 2, 3]).buffer;
    server.on('connection', (sock) => {
      sock.send(buf);
    });
    let receivedMessage: any;
    const ws = createDurableSocket(url, undefined, [jsonPlugin()]);
    ws.addEventListener('message', (e) => {
      receivedMessage = e.data;
    });

    await handshake();

    expect(receivedMessage).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(receivedMessage)).toEqual(new Uint8Array(buf));

    server.close();
  });

  it('is consistent through 50 reconnects', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();

      const messages: any[] = [];
      server.on('connection', (s) => s.on('message', (d) => messages.push(d)));

      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        jsonPlugin(),
      ]);

      await advance(100);

      for (let i = 0; i < 50; i++) {
        server.clients().forEach((c) => c.close());
        await advance(100);

        ws.send({ id: i });
        await advance(100);

        expect(messages.filter((m) => m !== 'ping').at(-1)).toEqual(
          JSON.stringify({ id: i })
        );
      }

      ws.close();
      dispose();
    });
  });

  it('is consistent through 50 reconnects with heartbeat', async () => {
    await createRoot(async (dispose) => {
      const [url, server] = getMockServer();

      const messages: any[] = [];
      server.on('connection', (s) => s.on('message', (d) => messages.push(d)));

      const ws = createDurableSocket(url, { delay: 50, retries: 2 }, [
        heartbeatPlugin({ interval: 3000, wait: 1000 }),
        jsonPlugin(),
      ]);

      await advance(100);

      for (let i = 0; i < 50; i++) {
        server.clients().forEach((c) => c.close());
        await advance(100);

        ws.send({ id: i });
        await advance(100);

        expect(messages.filter((m) => m !== 'ping').at(-1)).toEqual(
          JSON.stringify({ id: i })
        );
      }

      ws.close();
      dispose();
    });
  });
});
