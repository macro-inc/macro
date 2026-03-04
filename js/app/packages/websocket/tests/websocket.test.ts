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
 * This mock is always registered but only exercised when USE_TAURI_FACTORY=1
 * is set (which causes TauriWebSocketWrapper instances to be created).
 */
vi.mock('@tauri-apps/plugin-websocket', async () => {
  const { WebSocket } = await import('ws');

  type TauriMessage =
    | { type: 'Text'; data: string }
    | { type: 'Binary'; data: number[] }
    | { type: 'Close'; data: { code: number; reason: string } }
    | { type: 'Ping' }
    | { type: 'Pong' };

  class MockTauriWs {
    private _ws: InstanceType<typeof WebSocket>;
    private _callbacks: Set<(msg: TauriMessage) => void> = new Set();

    constructor(ws: InstanceType<typeof WebSocket>) {
      this._ws = ws;

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        const msg: TauriMessage = isBinary
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

    addListener(callback: (msg: TauriMessage) => void): () => void {
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
 * When USE_TAURI_FACTORY=1, replace platformWebSocketFactory so that every
 * Websocket/WebsocketBuilder automatically uses TauriWebSocketWrapper,
 * bypassing the isTauri() guard. Otherwise the default browser/Node WebSocket
 * is used without any changes to the test code.
 */
vi.mock('@websocket/platform/factory', async () => {
  const { TauriWebSocketWrapper } = await import('../platform/tauri-websocket');
  return {
    platformWebSocketFactory: (
      url: string | URL,
      protocols?: string | string[]
    ) =>
      process.env.USE_TAURI_FACTORY
        ? new TauriWebSocketWrapper(url.toString(), protocols)
        : new WebSocket(url, protocols),
  };
});

describe(
  process.env.USE_TAURI_FACTORY
    ? 'Testsuite for Websocket with TauriWebSocketWrapper'
    : 'Testsuite for Websocket',
  () => {
    const port: number = process.env.PORT ? parseInt(process.env.PORT) : 41337;
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

    /** The expected class for the underlying websocket, depending on the factory. */
    const UnderlyingWebSocketClass = process.env.USE_TAURI_FACTORY
      ? TauriWebSocketWrapper
      : WebSocket;

    let client: Websocket | undefined; // subject under test
    let server: WebSocketServer | undefined; // websocket server used for testing

    /** Before all tests, log the test configuration. */
    beforeAll(() =>
      console.log(
        `Testing websocket on ${url}, server timeout: ${serverTimeout}ms, client timeout: ${clientTimeout}ms`
      )
    );

    /** Before each test, start a websocket server on the given port. */
    beforeEach(async () => {
      await startServer(port, serverTimeout).then((s) => {
        server = s;
      });
    }, testTimeout);

    /** After each test, stop the websocket server. */
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
          const client = new Websocket(url);
          expect(client.url).toBe(url);
        });
      });

      describe('Protocols', () => {
        test('Websocket should return the correct protocols when protocols are a string', () => {
          const protocols = 'protocol1';
          const client = new Websocket(url, protocols);
          expect(client.protocols).toEqual(protocols);
        });

        test('Websocket should return the correct protocols when protocols are an array', () => {
          const protocols = ['protocol1', 'protocol2'];
          const client = new Websocket(url, protocols);
          expect(client.protocols).toEqual(protocols);
        });

        test('Websocket should return the correct protocols when protocols are undefined', () => {
          const client = new Websocket(url);
          expect(client.protocols).toBeUndefined();
        });
      });

      describe('Buffer', () => {
        test('Websocket should return the correct buffer when buffer is undefined', () => {
          const client = new Websocket(url);
          expect(client.buffer).toBeUndefined();
        });

        test('Websocket should return the correct buffer when buffer is set', () => {
          const buffer: WebsocketBuffer = new ArrayQueue();
          const client = new Websocket(url, undefined, { buffer });
          expect(client.buffer).toBe(buffer);
        });
      });

      describe('MaxRetries', () => {
        test('Websocket should return the correct maxRetries when maxRetries is undefined', () => {
          const client = new Websocket(url);
          expect(client.maxRetries).toBeUndefined();
        });

        test('Websocket should return the correct maxRetries when maxRetries is set', () => {
          const maxRetries = 5;
          const client = new Websocket(url, undefined, {
            retry: { maxRetries },
          });
          expect(client.maxRetries).toBe(maxRetries);
        });
      });

      describe('InstantReconnect', () => {
        test('Websocket should return the correct instantReconnect when instantReconnect is undefined', () => {
          const client = new Websocket(url);
          expect(client.instantReconnect).toBeUndefined();
        });

        test('Websocket should return the correct instantReconnect when instantReconnect is set', () => {
          const instantReconnect = true;
          const client = new Websocket(url, undefined, {
            retry: { instantReconnect },
          });
          expect(client.instantReconnect).toBe(instantReconnect);
        });
      });

      describe('Backoff', () => {
        test('Websocket should return the correct backoff when backoff is undefined', () => {
          const client = new Websocket(url);
          expect(client.backoff).toBeUndefined();
        });

        test('Websocket should return the correct backoff when backoff is set', () => {
          const backoff: Backoff = new ConstantBackoff(1000);
          const client = new Websocket(url, undefined, {
            retry: { backoff },
          });
          expect(client.backoff).toBe(backoff);
        });
      });

      describe('ClosedByUser', () => {
        test('Websocket should return false after initialization', () => {
          const client = new Websocket(url);
          expect(client.closedByUser).toBe(false);
        });

        test('Websocket should return true after the client closes the connection', async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
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
          const client = new Websocket(url);
          expect(client.lastConnection).toBeUndefined();
        });

        test('Websocket should return the correct date after the client connects to the server', async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
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
        test(`Websocket should return ${process.env.USE_TAURI_FACTORY ? 'TauriWebSocketWrapper' : 'native websocket'} after initialization`, async () => {
          const client = new Websocket(url);
          await untilEvent(client, WebsocketEvent.UrlResolved);
          expect(client.underlyingWebsocket).not.toBeUndefined();
          expect(client.underlyingWebsocket).toBeInstanceOf(
            UnderlyingWebSocketClass
          );
        });

        test('Websocket should return the underlying websocket after the client connects to the server', async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
                .onOpen((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Open);
            expect(instance.underlyingWebsocket).not.toBeUndefined();
            expect(instance.underlyingWebsocket).toBeInstanceOf(
              UnderlyingWebSocketClass
            );
          });
        });

        test('Websocket should return the underlying websocket after the client closes the connection', async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
                .onOpen((instance) => instance.close())
                .onClose((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Close);
            expect(instance.underlyingWebsocket).not.toBeUndefined();
            expect(instance.underlyingWebsocket).toBeInstanceOf(
              UnderlyingWebSocketClass
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
                .onOpen(() => closeServer(server))
                .onClose((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Close);
            expect(instance.underlyingWebsocket).not.toBeUndefined();
            expect(instance.underlyingWebsocket).toBeInstanceOf(
              UnderlyingWebSocketClass
            );
            expect(instance.underlyingWebsocket!.readyState).toBe(
              WebSocket.CLOSED
            );
          });
        });
      });

      describe('ReadyState', () => {
        test('Websocket should return the correct readyState after initialization', async () => {
          const client = new Websocket(url);
          await untilEvent(client, WebsocketEvent.UrlResolved);
          expect(client.readyState).toBe(WebSocket.CONNECTING);
        });

        test('Websocket should return the correct readyState after the client connects to the server', async () => {
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
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
          const client = new Websocket(url);
          await untilEvent(client, WebsocketEvent.UrlResolved);
          expect(client.bufferedAmount).toBe(0);
        });
      });

      describe('Extensions', () => {
        test('Websocket should return the correct extensions after initialization', async () => {
          const client = new Websocket(url);
          await untilEvent(client, WebsocketEvent.UrlResolved);
          expect(client.extensions).toBe('');
        });
      });

      describe('BinaryType', () => {
        test('Websocket should return the correct binaryType after initialization', () => {
          const client = new Websocket(url);
          expect(client.binaryType).toBe('blob');
        });

        test('Websocket should return the correct binaryType after setting it', () => {
          const client = new Websocket(url);
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
            await new Promise<
              WebsocketEventListenerParams<WebsocketEvent.Open>
            >((resolve) => {
              client = new WebsocketBuilder(url)
                .onOpen((instance, ev) => resolve([instance, ev]))
                .build();
            }).then(([instance, ev]) => {
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
                .withBackoff(new ConstantBackoff(0))
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
                .withBackoff(new ConstantBackoff(100)) // try to reconnect after 100ms, 'open' should only fire once
                .onOpen(
                  (i, ev) => {
                    timesOpenFired++;
                    resolve([i, ev]);
                  },
                  { once: true }
                ) // initial 'open' event, should only fire once
                .build();
            }
          );

          // this resolves after the client has connected to the server, disconnect it right after
          await clientConnectionPromise;
          expect(timesOpenFired).toBe(1);
          expect(
            getListenersWithOptions(client, WebsocketEvent.Open)
          ).toHaveLength(0); // since the initial listener was a 'once'-listener, this should be empty
          client!.addEventListener(WebsocketEvent.Open, onOpen); // add a new listener
          expect(
            getListenersWithOptions(client, WebsocketEvent.Open)
          ).toHaveLength(1); // since the initial listener was a 'once'-listener, this should be empty
          server?.clients.forEach((c: WsWebSocket) => c.close());

          // wait for the client to reconnect after 100ms
          await waitForClientToConnectToServer(server, clientTimeout);
          await new Promise((resolve) => setTimeout(resolve, 100)); // wait some extra time for client-side event to be fired
          expect(timesOpenFired).toBe(2);
          expect(
            getListenersWithOptions(client, WebsocketEvent.Open)
          ).toHaveLength(1); // since the initial listener was a 'once'-listener, this should be empty

          // remove the event-listener, disconnect again
          client!.removeEventListener(WebsocketEvent.Open, onOpen);
          expect(
            getListenersWithOptions(client, WebsocketEvent.Open)
          ).toHaveLength(0);
          server?.clients.forEach((c: WsWebSocket) => c.close());

          // wait for the client to reconnect after 100ms, 'open' should not fire again and timesOpenFired will still be 2
          await waitForClientToConnectToServer(server, clientTimeout);
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(timesOpenFired).toBe(2);
        });
      });

      describe('Close', () => {
        test(
          "Websocket should fire 'close' when the server closes the connection and the underlying websocket should be in readyState 'CLOSED'",
          async () => {
            await new Promise<
              WebsocketEventListenerParams<WebsocketEvent.Close>
            >((resolve) => {
              client = new WebsocketBuilder(url)
                .onOpen(() => closeServer(server))
                .onClose((instance, ev) => resolve([instance, ev]))
                .build();
            }).then(([instance, ev]) => {
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
                .onOpen(() =>
                  server?.clients.forEach((client: WsWebSocket) =>
                    client.close(1001, 'CLOSE_GOING_AWAY')
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
          // close codes to the server (the Tauri plugin API has no parameters
          // for disconnect). When USE_TAURI_FACTORY=1, the CloseEvent therefore
          // carries code 1000 instead of the requested 4000. closedByUser and
          // readyState are still asserted correctly.
          await new Promise<WebsocketEventListenerParams<WebsocketEvent.Close>>(
            (resolve) => {
              client = new WebsocketBuilder(url)
                .onOpen((instance) =>
                  instance.close(4000, 'APPLICATION_IS_SHUTTING_DOWN')
                )
                .onClose((instance, ev) => resolve([instance, ev]))
                .build();
            }
          ).then(([instance, ev]) => {
            expect(instance).toBe(client);
            expect(ev.type).toBe(WebsocketEvent.Close);
            if (!process.env.USE_TAURI_FACTORY) {
              expect(ev.code).toBe(4000);
              expect(ev.reason).toBe('APPLICATION_IS_SHUTTING_DOWN');
              expect(ev.wasClean).toBe(true);
            }
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
          await new Promise<
            WebsocketEventListenerParams<WebsocketEvent.Message>
          >((resolve) => {
            client = new WebsocketBuilder(url)
              .onOpen(() =>
                server?.clients.forEach((client: WsWebSocket) =>
                  client.send('Hello')
                )
              )
              .onMessage((instance, ev) => {
                expect(ev.data).toBe('Hello');
                resolve([instance, ev]);
              })
              .build();
          }).then(([instance, ev]) => {
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
                .withBackoff(new ConstantBackoff(0)) // immediately retry
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

          // give some time for all handlers to be called
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(openCount).toBe(1);
          expect(retryCount).toBe(0);
          expect(reconnectCount).toBe(0);

          // disconnect all clients and give some time for the retry to happen
          server?.clients.forEach((client: WsWebSocket) => client.close());
          await new Promise((resolve) => setTimeout(resolve, 200));

          // ws should have retried & reconnect
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
                .withBackoff(new ConstantBackoff(1000)) // retry after 1 second
                .withInstantReconnect(true) // reconnect immediately, don't wait for the backoff for the first retry
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

          // give some time for all handlers to be called
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(openCount).toBe(1);
          expect(retryCount).toBe(0);
          expect(reconnectCount).toBe(0);

          // disconnect all clients and give some time for the retry to happen
          server?.clients.forEach((client: WsWebSocket) => client.close());
          await new Promise((resolve) => setTimeout(resolve, 200));

          // ws should have retried & reconnect
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
                .withBackoff(new ConstantBackoff(1000)) // retry after 1 second
                .withInstantReconnect(false) // reconnect immediately, don't wait for the backoff for the first retry
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

          // give some time for all handlers to be called
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(openCount).toBe(1);
          expect(retryCount).toBe(0);
          expect(reconnectCount).toBe(0);

          // disconnect all clients and give some time for the retry to happen
          server?.clients.forEach((client: WsWebSocket) => client.close());
          await new Promise((resolve) => setTimeout(resolve, 100));

          // ws shouldn't have retried & reconnect
          expect(openCount).toBe(1);
          expect(retryCount).toBe(0);
          expect(reconnectCount).toBe(0);

          // give some time for the retry to happen
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
                .withBackoff(new ConstantBackoff(0)) // retry after 1 second
                .withMaxRetries(5) // retry 5 times
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

          // give some time for all handlers to be called
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(openCount).toBe(1);
          expect(retryCount).toBe(0);
          expect(reconnectCount).toBe(0);

          // stop server so that the client can't reconnect
          await stopServer(server, serverTimeout);
          // Each retry attempt hits ECONNREFUSED on both IPv4 and IPv6 which
          // takes longer per attempt than a simple event-loop tick.  500 ms is
          // enough for 5 × ConstantBackoff(0) retries to complete.
          await new Promise((resolve) => setTimeout(resolve, 500));

          // ws should have retried but not reconnect
          expect(openCount).toBe(1);
          expect(retryCount).toBe(5);
          expect(reconnectCount).toBe(0);
        });
      });
    });

    describe('Send', () => {
      test('Websocket should send a message to the server and the server should receive it', async () => {
        const serverReceivedMessage = new Promise<string>((resolve) => {
          server?.on('connection', (client: WsWebSocket) => {
            client?.on(
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
          server?.on('connection', (client: WsWebSocket) => {
            client?.on('message', (message: Uint8Array) => {
              resolve(message);
            });
          });
        });

        await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
          (resolve) => {
            client = new WebsocketBuilder(url)
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
          expect(Buffer.from(message).equals(Buffer.from([1, 2, 3]))).toBe(
            true
          );
        });
      });

      test('Websocket should buffer messages sent before the connection is open and send them when the connection is open', async () => {
        const messagesReceived: string[] = [];
        const serverReceivedMessages = new Promise<string[]>((resolve) => {
          server?.on('connection', (client: WsWebSocket) => {
            client?.on(
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
              .withBuffer(new ArrayQueue())
              .onOpen((instance, ev) => {
                setTimeout(() => {
                  instance.send('Hello2');
                  resolve([instance, ev]);
                }, 100);
              })
              .build();
            client.send('Hello1'); // This message should be buffered
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
              .onOpen((instance, ev) => resolve([instance, ev]))
              .build();
          }
        ).then(([instance, ev]) => {
          expect(instance).toBe(client);
          expect(ev.type).toBe(WebsocketEvent.Open);
          expect(instance.underlyingWebsocket).not.toBeUndefined();
          expect(instance.underlyingWebsocket!.readyState).toBe(WebSocket.OPEN);

          // close the websocket and send a message
          instance.close();
          instance.send('This send should short circuit');
        });
      });
    });

    describe('Send/Receive with serializer', () => {
      test('Websocket should send a message to the server and the server should receive it', async () => {
        let client: Websocket<Record<any, any>, Record<any, any>> | undefined;
        const serverReceivedMessage = new Promise<string>((resolve) => {
          server?.on('connection', (client: WsWebSocket) => {
            client?.on(
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
          server?.on('connection', (client: WsWebSocket) => {
            client?.on(
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
            .withBuffer(new ArrayQueue())
            .onOpen((instance, ev) => {
              setTimeout(() => {
                instance.send({ message: 'Hello2' });
                resolve([instance, ev]);
              }, 100);
            })
            .build();
          client.send({ message: 'Hello1' }); // This message should be buffered
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
  }
);
