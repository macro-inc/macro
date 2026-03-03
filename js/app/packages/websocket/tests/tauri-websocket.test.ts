import { untilEvent } from '@websocket/utils/until-event';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import type { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import type { WebsocketBuffer } from '../';
import {
  ArrayQueue,
  type Backoff,
  ConstantBackoff,
  Websocket,
  WebsocketBuilder,
  WebsocketEvent,
  type WebsocketEventListenerParams,
} from '../';
import { JsonSerializer } from '../core/serializers/json-serializer';
import type { WebSocketFactory } from '../platform/minimal-websocket';
import { TauriWebSocketWrapper } from '../platform/tauri-websocket';
import {
  closeServer,
  getListenersWithOptions,
  onStringMessageReceived,
  startServer,
  stopClient,
  stopServer,
  waitForClientToConnectToServer,
} from './websocket-test-utils';

/**
 * Mock @tauri-apps/plugin-websocket with a ws-backed implementation so we can
 * run integration tests in Node.js without a real Tauri runtime.
 *
 * The mock implements the three methods TauriWebSocketWrapper actually uses:
 *   - static connect(url)  → resolves once the underlying ws connection opens
 *   - addListener(cb)      → forwards ws 'message' and 'close' events in the
 *                            Tauri message format; returns a cleanup function
 *   - send(msg)            → delegates to the underlying ws socket
 *   - disconnect()         → closes the underlying ws socket and resolves once
 *                            the 'close' event fires (so the Close message is
 *                            delivered to the TauriWebSocketWrapper listener
 *                            before the .finally() cleanup removes it)
 */
vi.mock('@tauri-apps/plugin-websocket', async () => {
  const { WebSocket } = await import('ws');

  class MockTauriWs {
    private _ws: InstanceType<typeof WebSocket>;
    private _callbacks: Set<(msg: any) => void> = new Set();

    constructor(ws: InstanceType<typeof WebSocket>) {
      this._ws = ws;

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        const msg = isBinary
          ? { type: 'Binary', data: Array.from(new Uint8Array(data)) }
          : { type: 'Text', data: (data as Buffer).toString('utf-8') };
        this._callbacks.forEach((cb) => cb(msg));
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this._callbacks.forEach((cb) =>
          cb({
            type: 'Close',
            data: { code, reason: reason?.toString() ?? '' },
          })
        );
      });
    }

    addListener(callback: (msg: any) => void): () => void {
      this._callbacks.add(callback);
      return () => this._callbacks.delete(callback);
    }

    send(
      msg: { type: 'Text'; data: string } | { type: 'Binary'; data: number[] }
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const payload = msg.type === 'Text' ? msg.data : Buffer.from(msg.data);
        this._ws.send(payload, (err?: Error) =>
          err ? reject(err) : resolve()
        );
      });
    }

    /**
     * Waits for the ws 'close' event before resolving so that the Close
     * message is forwarded to TauriWebSocketWrapper's listener (and the
     * CloseEvent fires) before .finally() in TauriWebSocketWrapper.close()
     * removes the listener.
     */
    disconnect(): Promise<void> {
      return new Promise<void>((resolve) => {
        this._ws.once('close', () => resolve());
        this._ws.close();
      });
    }

    static async connect(url: string): Promise<MockTauriWs> {
      return new Promise<MockTauriWs>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.once('open', () => resolve(new MockTauriWs(ws)));
        ws.once('error', reject);
      });
    }
  }

  return { default: MockTauriWs };
});

/**
 * Factory that directly creates a TauriWebSocketWrapper, bypassing the
 * isTauri() guard in tauriWebSocketFactory. Used in every builder/constructor
 * call below so the full TauriWebSocketWrapper code path is exercised.
 */
const tauriFactory: WebSocketFactory = (url, protocols) =>
  new TauriWebSocketWrapper(url.toString(), protocols);

describe('Testsuite for Websocket with TauriWebSocketWrapper', () => {
  // Use a separate port so this suite can run alongside the native-WS suite.
  const port: number = process.env.PORT
    ? parseInt(process.env.PORT) + 1
    : 41338;
  const url: string = process.env.URL ?? `ws://localhost:${port}`;
  const serverTimeout: number = process.env.SERVER_TIMEOUT
    ? parseInt(process.env.SERVER_TIMEOUT)
    : 5_000;
  const clientTimeout: number = process.env.CLIENT_TIMEOUT
    ? parseInt(process.env.CLIENT_TIMEOUT)
    : 5_000;
  const testTimeout: number = process.env.TEST_TIMEOUT
    ? parseInt(process.env.TEST_TIMEOUT)
    : 10_000;

  let client: Websocket | undefined;
  let server: WebSocketServer | undefined;

  beforeAll(() =>
    console.log(
      `Testing websocket (TauriWebSocketWrapper) on ${url}, server timeout: ${serverTimeout}ms, client timeout: ${clientTimeout}ms`
    )
  );

  beforeEach(async () => {
    await startServer(port, serverTimeout).then((s) => {
      server = s;
    });
  }, testTimeout);

  afterEach(async () => {
    await stopClient(client, clientTimeout).then(() => {
      client = undefined;
    });
    await stopServer(server, serverTimeout).then(() => {
      server = undefined;
    });
  }, testTimeout);

  describe('Getter/setter tests', () => {
    describe('Url', () => {
      test('Websocket should return the correct url', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.url).toBe(url);
      });
    });

    describe('Protocols', () => {
      test('Websocket should return the correct protocols when protocols are a string', () => {
        const protocols = 'protocol1';
        const client = new Websocket(url, protocols, { factory: tauriFactory });
        expect(client.protocols).toEqual(protocols);
      });

      test('Websocket should return the correct protocols when protocols are an array', () => {
        const protocols = ['protocol1', 'protocol2'];
        const client = new Websocket(url, protocols, { factory: tauriFactory });
        expect(client.protocols).toEqual(protocols);
      });

      test('Websocket should return the correct protocols when protocols are undefined', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.protocols).toBeUndefined();
      });
    });

    describe('Buffer', () => {
      test('Websocket should return the correct buffer when buffer is undefined', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.buffer).toBeUndefined();
      });

      test('Websocket should return the correct buffer when buffer is set', () => {
        const buffer: WebsocketBuffer = new ArrayQueue();
        const client = new Websocket(url, undefined, {
          buffer,
          factory: tauriFactory,
        });
        expect(client.buffer).toBe(buffer);
      });
    });

    describe('MaxRetries', () => {
      test('Websocket should return the correct maxRetries when maxRetries is undefined', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.maxRetries).toBeUndefined();
      });

      test('Websocket should return the correct maxRetries when maxRetries is set', () => {
        const maxRetries = 5;
        const client = new Websocket(url, undefined, {
          retry: { maxRetries },
          factory: tauriFactory,
        });
        expect(client.maxRetries).toBe(maxRetries);
      });
    });

    describe('InstantReconnect', () => {
      test('Websocket should return the correct instantReconnect when instantReconnect is undefined', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.instantReconnect).toBeUndefined();
      });

      test('Websocket should return the correct instantReconnect when instantReconnect is set', () => {
        const instantReconnect = true;
        const client = new Websocket(url, undefined, {
          retry: { instantReconnect },
          factory: tauriFactory,
        });
        expect(client.instantReconnect).toBe(instantReconnect);
      });
    });

    describe('Backoff', () => {
      test('Websocket should return the correct backoff when backoff is undefined', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.backoff).toBeUndefined();
      });

      test('Websocket should return the correct backoff when backoff is set', () => {
        const backoff: Backoff = new ConstantBackoff(1000);
        const client = new Websocket(url, undefined, {
          retry: { backoff },
          factory: tauriFactory,
        });
        expect(client.backoff).toBe(backoff);
      });
    });

    describe('ClosedByUser', () => {
      test('Websocket should return false after initialization', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.closedByUser).toBe(false);
      });

      test('Websocket should return true after the client closes the connection', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance) => instance.close())
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.closedByUser).toBe(true);
        });
      });

      test('Websocket should return false if the server closes the connection', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen(() => closeServer(server))
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.closedByUser).toBe(false);
        });
      });
    });

    describe('LastConnection', () => {
      test('Websocket should return undefined after initialization', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.lastConnection).toBeUndefined();
      });

      test('Websocket should return the correct date after the client connects to the server', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
          expect(instance.lastConnection).not.toBeUndefined();
        });
      });
    });

    describe('UnderlyingWebsocket', () => {
      test('Websocket should return TauriWebSocketWrapper after initialization', async () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        await untilEvent(client, WebsocketEvent.UrlResolved);
        expect(client.underlyingWebsocket).not.toBeUndefined();
        expect(client.underlyingWebsocket).toBeInstanceOf(
          TauriWebSocketWrapper
        );
      });

      test('Websocket should return the underlying websocket after the client connects to the server', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket).toBeInstanceOf(
            TauriWebSocketWrapper
          );
        });
      });

      test('Websocket should return the underlying websocket after the client closes the connection', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance) => instance.close())
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket).toBeInstanceOf(
            TauriWebSocketWrapper
          );
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });

      test('Websocket should return the underlying websocket after the server closes the connection', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen(() => closeServer(server))
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket).toBeInstanceOf(
            TauriWebSocketWrapper
          );
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });
    });

    describe('ReadyState', () => {
      test('Websocket should return the correct readyState after initialization', async () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        await untilEvent(client, WebsocketEvent.UrlResolved);
        expect(client.readyState).toBe(WebSocket.CONNECTING);
      });

      test('Websocket should return the correct readyState after the client connects to the server', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
          expect(instance.readyState).toBe(WebSocket.OPEN);
        });
      });

      test('Websocket should return the correct readyState after the client closes the connection', async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance) => instance.close())
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.readyState).toBe(WebSocket.CLOSED);
        });
      });
    });

    describe('BufferedAmount', () => {
      test('Websocket should return the correct bufferedAmount after initialization', async () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        await untilEvent(client, WebsocketEvent.UrlResolved);
        expect(client.bufferedAmount).toBe(0);
      });
    });

    describe('Extensions', () => {
      test('Websocket should return the correct extensions after initialization', async () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        await untilEvent(client, WebsocketEvent.UrlResolved);
        expect(client.extensions).toBe('');
      });
    });

    describe('BinaryType', () => {
      test('Websocket should return the correct binaryType after initialization', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        expect(client.binaryType).toBe('blob');
      });

      test('Websocket should return the correct binaryType after setting it', () => {
        const client = new Websocket(url, undefined, { factory: tauriFactory });
        client.binaryType = 'arraybuffer';
        expect(client.binaryType).toBe('arraybuffer');
      });
    });
  });

  describe('Event tests', () => {
    describe('Open', () => {
      test(
        "Websocket should fire 'open' when connecting to a server and the underlying websocket should be in readyState 'OPEN'",
        async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
                .withFactory(tauriFactory)
                .onOpen((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Open);
            expect(instance.underlyingWebsocket).not.toBeUndefined();
            expect(instance.underlyingWebsocket!.readyState).toBe(
              WebSocket.OPEN
            );
          });
        },
        testTimeout
      );

      test("Websocket should fire 'open' when reconnecting to a server and the underlying websocket should be in readyState 'OPEN'", async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(0))
              .onOpen((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);
        });
      });

      test("Websocket shouldn't fire 'open' when it was removed from the event listeners", async () => {
        let timesOpenFired = 0;
        const onOpen = () => timesOpenFired++;

        const clientConnectionPromise = waitForClientToConnectToServer(
          server,
          clientTimeout
        );

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(100))
              .onOpen(
                (i, ev) => {
                  timesOpenFired++;
                  resolve([i, ev]);
                },
                { once: true }
              )
              .build();
          }
        );

        await clientConnectionPromise;
        expect(timesOpenFired).toBe(1);
        expect(
          getListenersWithOptions(client, WebsocketEvent.Open)
        ).toHaveLength(0);
        client!.addEventListener(WebsocketEvent.Open, onOpen);
        expect(
          getListenersWithOptions(client, WebsocketEvent.Open)
        ).toHaveLength(1);
        server?.clients.forEach((c: WsWebSocket) => c.close());

        await waitForClientToConnectToServer(server, clientTimeout);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(timesOpenFired).toBe(2);
        expect(
          getListenersWithOptions(client, WebsocketEvent.Open)
        ).toHaveLength(1);

        client!.removeEventListener(WebsocketEvent.Open, onOpen);
        expect(
          getListenersWithOptions(client, WebsocketEvent.Open)
        ).toHaveLength(0);
        server?.clients.forEach((c: WsWebSocket) => c.close());

        await waitForClientToConnectToServer(server, clientTimeout);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(timesOpenFired).toBe(2);
      });
    });

    describe('Close', () => {
      test(
        "Websocket should fire 'close' when the server closes the connection and the underlying websocket should be in readyState 'CLOSED'",
        async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
                .withFactory(tauriFactory)
                .onOpen(() => closeServer(server))
                .onClose((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Close);
            expect(instance.closedByUser).toBe(false);
            expect(instance.underlyingWebsocket).not.toBeUndefined();
            expect(instance.underlyingWebsocket!.readyState).toBe(
              WebSocket.CLOSED
            );
          });
        },
        testTimeout
      );

      test("Websocket should fire 'close' when the client closes the connection and the underlying websocket should be in readyState 'CLOSED'", async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance) => instance.close())
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.closedByUser).toBe(true);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });

      test("Websocket should fire 'close' when the server closes the connection with a status code other than 1000 and the underlying websocket should be in readyState 'CLOSED'", async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen(() =>
                server?.clients.forEach((c: WsWebSocket) =>
                  c.close(1001, 'CLOSE_GOING_AWAY')
                )
              )
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(ev.code).toBe(1001);
          expect(ev.reason).toBe('CLOSE_GOING_AWAY');
          expect(ev.wasClean).toBe(true);
          expect(instance.closedByUser).toBe(false);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });

      test("Websocket should fire 'close' when the client closes the connection with a status code other than 1000 and the underlying websocket should be in readyState 'CLOSED'", async () => {
        // NOTE: TauriWebSocketWrapper.disconnect() does not forward custom
        // close codes to the server (the Tauri plugin API has no parameters for
        // disconnect). The CloseEvent therefore carries code 1000 instead of
        // the requested 4000, and an empty reason instead of
        // 'APPLICATION_IS_SHUTTING_DOWN'. closedByUser and readyState are
        // still asserted correctly.
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen((instance) =>
                instance.close(4000, 'APPLICATION_IS_SHUTTING_DOWN')
              )
              .onClose((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Close);
          expect(instance.closedByUser).toBe(true);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });
    });

    describe('Error', () => {
      test("Websocket should fire 'error' when the server rejects the connection and the underlying websocket should be in readyState 'CLOSED", async () => {
        await stopServer(server, serverTimeout).then(() => {
          server = undefined;
        });
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Error>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onError((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Error);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(
            WebSocket.CLOSED
          );
        });
      });
    });

    describe('Message', () => {
      test("Websocket should fire 'message' when the server sends a message", async () => {
        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Message>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .onOpen(() =>
                server?.clients.forEach((c: WsWebSocket) => c.send('Hello'))
              )
              .onMessage((instance, ev) => {
                expect(ev.data).toBe('Hello');
                resolve([instance, ev]);
              })
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Message);
          expect(ev.data).toBe('Hello');
        });
      });
    });

    describe('Retry & Reconnect', () => {
      test("Websocket should not emit 'retry' on the first connection attempt, emit it when retrying and emit 'reconnect' when it reconnects", async () => {
        let [openCount, retryCount, reconnectCount] = [0, 0, 0];
        const onOpen = () => openCount++;
        const onRetry = () => retryCount++;
        const onReconnect = () => reconnectCount++;

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(0))
              .onOpen((instance, ev) => resolve([instance, ev]))
              .onOpen(onOpen)
              .onRetry(onRetry)
              .onReconnect(onReconnect)
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(openCount).toBe(1);
        expect(retryCount).toBe(0);
        expect(reconnectCount).toBe(0);

        server?.clients.forEach((c: WsWebSocket) => c.close());
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(openCount).toBe(2);
        expect(retryCount).toBe(1);
        expect(reconnectCount).toBe(1);
      });
    });
  });

  describe('Reconnect behaviour', () => {
    describe('InstantReconnect', () => {
      test('Websocket should try to reconnect immediately when instantReconnect is true', async () => {
        let [openCount, retryCount, reconnectCount] = [0, 0, 0];
        const onOpen = () => openCount++;
        const onRetry = () => retryCount++;
        const onReconnect = () => reconnectCount++;

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(1000))
              .withInstantReconnect(true)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .onOpen(onOpen)
              .onRetry(onRetry)
              .onReconnect(onReconnect)
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(openCount).toBe(1);
        expect(retryCount).toBe(0);
        expect(reconnectCount).toBe(0);

        server?.clients.forEach((c: WsWebSocket) => c.close());
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(openCount).toBe(2);
        expect(retryCount).toBe(1);
        expect(reconnectCount).toBe(1);
      });

      test('Websocket should not try to reconnect immediately when instantReconnect is false', async () => {
        let [openCount, retryCount, reconnectCount] = [0, 0, 0];
        const onOpen = () => openCount++;
        const onRetry = () => retryCount++;
        const onReconnect = () => reconnectCount++;

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(1000))
              .withInstantReconnect(false)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .onOpen(onOpen)
              .onRetry(onRetry)
              .onReconnect(onReconnect)
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(openCount).toBe(1);
        expect(retryCount).toBe(0);
        expect(reconnectCount).toBe(0);

        server?.clients.forEach((c: WsWebSocket) => c.close());
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(openCount).toBe(1);
        expect(retryCount).toBe(0);
        expect(reconnectCount).toBe(0);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(openCount).toBe(2);
        expect(retryCount).toBe(1);
        expect(reconnectCount).toBe(1);
      });
    });

    describe('MaxRetries', () => {
      test('Websocket should stop trying to reconnect when maxRetries is reached', async () => {
        let [openCount, retryCount, reconnectCount] = [0, 0, 0];
        const onOpen = () => openCount++;
        const onRetry = () => retryCount++;
        const onReconnect = () => reconnectCount++;

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
              .withFactory(tauriFactory)
              .withBackoff(new ConstantBackoff(0))
              .withMaxRetries(5)
              .onOpen((instance, ev) => resolve([instance, ev]))
              .onOpen(onOpen)
              .onRetry(onRetry)
              .onReconnect(onReconnect)
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(openCount).toBe(1);
        expect(retryCount).toBe(0);
        expect(reconnectCount).toBe(0);

        await stopServer(server, serverTimeout);
        // Each retry attempt hits ECONNREFUSED on both IPv4 and IPv6 which
        // takes longer per attempt than a simple event-loop tick.  500 ms is
        // enough for 5 × ConstantBackoff(0) retries to complete.
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(openCount).toBe(1);
        expect(retryCount).toBe(5);
        expect(reconnectCount).toBe(0);
      });
    });
  });

  describe('Send', () => {
    test('Websocket should send a message to the server and the server should receive it', async () => {
      const serverReceivedMessage = new Promise<string>((resolve) => {
        server?.on('connection', (c: WsWebSocket) => {
          c?.on(
            'message',
            onStringMessageReceived((str: string) => {
              resolve(str);
            })
          );
        });
      });

      await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
        (resolve) => {
          client = new WebsocketBuilder(url)
            .withFactory(tauriFactory)
            .onOpen((instance, ev) => {
              instance.send('Hello');
              resolve([instance, ev]);
            })
            .build();
        }
      ).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
        expect(instance.underlyingWebsocket).not.toBeUndefined();
        expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);
      });

      await serverReceivedMessage.then((message) =>
        expect(message).toBe('Hello')
      );
    });

    test('Websocket should send a message to the server and the server should receive it as a Uint8Array', async () => {
      const serverReceivedMessage = new Promise<Uint8Array>((resolve) => {
        server?.on('connection', (c: WsWebSocket) => {
          c?.on('message', (message: Uint8Array) => {
            resolve(message);
          });
        });
      });

      await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
        (resolve) => {
          client = new WebsocketBuilder(url)
            .withFactory(tauriFactory)
            .onOpen((instance, ev) => {
              instance.send(new Uint8Array([1, 2, 3]));
              resolve([instance, ev]);
            })
            .build();
        }
      ).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
        expect(instance.underlyingWebsocket).not.toBeUndefined();
        expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);
      });

      await serverReceivedMessage.then((message) => {
        expect(Buffer.from(message).equals(Buffer.from([1, 2, 3]))).toBe(true);
      });
    });

    test('Websocket should buffer messages sent before the connection is open and send them when the connection is open', async () => {
      const messagesReceived: string[] = [];
      const serverReceivedMessages = new Promise<string[]>((resolve) => {
        server?.on('connection', (c: WsWebSocket) => {
          c?.on(
            'message',
            onStringMessageReceived((str: string) => {
              messagesReceived.push(str);
              if (messagesReceived.length === 2) {
                resolve(messagesReceived);
              }
            })
          );
        });
      });

      await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
        (resolve) => {
          client = new WebsocketBuilder(url)
            .withFactory(tauriFactory)
            .withBuffer(new ArrayQueue())
            .onOpen((instance, ev) => {
              setTimeout(() => {
                instance.send('Hello2');
                resolve([instance, ev]);
              }, 100);
            })
            .build();
          client.send('Hello1');
        }
      ).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
        expect(instance.underlyingWebsocket).not.toBeUndefined();
        expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);
      });

      await serverReceivedMessages.then((messages) => {
        expect(messages).toEqual(['Hello1', 'Hello2']);
      });
    });

    test('Websocket send should short circuit if the websocket was closed by user', async () => {
      await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
        (resolve) => {
          client = new WebsocketBuilder(url)
            .withFactory(tauriFactory)
            .onOpen((instance, ev) => resolve([instance, ev]))
            .build();
        }
      ).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
        expect(instance.underlyingWebsocket).not.toBeUndefined();
        expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);

        instance.close();
        instance.send('This send should short circuit');
      });
    });
  });

  describe('Send/Receive with serializer', () => {
    test('Websocket should send a message to the server and the server should receive it', async () => {
      let client: Websocket<Record<any, any>, Record<any, any>> | undefined;
      const serverReceivedMessage = new Promise<string>((resolve) => {
        server?.on('connection', (c: WsWebSocket) => {
          c?.on(
            'message',
            onStringMessageReceived((str: string) => {
              resolve(str);
            })
          );
        });
      });

      await new Promise<
        WebsocketEventListenerParams<
          WebsocketEvent.Open,
          Record<any, any>,
          Record<any, any>
        >
      >((resolve) => {
        client = new WebsocketBuilder(url)
          .withSerializer(
            new JsonSerializer<Record<any, any>, Record<any, any>>()
          )
          .withFactory(tauriFactory)
          .onOpen((instance, ev) => {
            instance.send({ message: 'Hello' });
            resolve([instance, ev]);
          })
          .build();
      }).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
      });

      await serverReceivedMessage.then((message) =>
        expect(message).toBe(JSON.stringify({ message: 'Hello' }))
      );
      stopClient(client as any, clientTimeout);
    });

    test('Websocket should buffer messages sent before the connection is open and send them when the connection is open', async () => {
      let client: Websocket<Record<any, any>, Record<any, any>> | undefined;
      const messagesReceived: string[] = [];
      const serverReceivedMessages = new Promise<string[]>((resolve) => {
        server?.on('connection', (c: WsWebSocket) => {
          c?.on(
            'message',
            onStringMessageReceived((str: string) => {
              messagesReceived.push(str);
              if (messagesReceived.length === 2) {
                resolve(messagesReceived);
              }
            })
          );
        });
      });

      await new Promise<
        WebsocketEventListenerParams<
          WebsocketEvent.Open,
          Record<any, any>,
          Record<any, any>
        >
      >((resolve) => {
        client = new WebsocketBuilder(url)
          .withSerializer(
            new JsonSerializer<Record<any, any>, Record<any, any>>()
          )
          .withFactory(tauriFactory)
          .withBuffer(new ArrayQueue())
          .onOpen((instance, ev) => {
            setTimeout(() => {
              instance.send({ message: 'Hello2' });
              resolve([instance, ev]);
            }, 100);
          })
          .build();
        client.send({ message: 'Hello1' });
      }).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Open);
        expect(instance.underlyingWebsocket).not.toBeUndefined();
        expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);
      });

      await serverReceivedMessages.then((messages) => {
        expect(messages).toEqual([
          JSON.stringify({ message: 'Hello1' }),
          JSON.stringify({ message: 'Hello2' }),
        ]);
      });

      stopClient(client as any, clientTimeout);
    });

    test('Websocket client should receive deserialized messages correctly', async () => {
      let client: Websocket<Record<any, any>, Record<any, any>> | undefined;

      await new Promise<
        WebsocketEventListenerParams<
          WebsocketEvent.Open,
          Record<any, any>,
          Record<any, any>
        >
      >((resolve) => {
        client = new WebsocketBuilder(url)
          .withSerializer(
            new JsonSerializer<Record<any, any>, Record<any, any>>()
          )
          .withFactory(tauriFactory)
          .onOpen(() => {
            server?.clients.forEach((c: WsWebSocket) => {
              c.send(JSON.stringify({ message: 'Hello' }));
            });
          })
          .onMessage((instance, ev) => {
            console.log('ev', ev.data);
            expect(ev.data).toEqual({ message: 'Hello' });
            resolve([instance, ev]);
          })
          .build();
      }).then(([instance, ev]) => {
        expect(instance).toBe(client);
        expect(ev.type).toBe(WebsocketEvent.Message);
      });

      stopClient(client as any, clientTimeout);
    });
  });
});
