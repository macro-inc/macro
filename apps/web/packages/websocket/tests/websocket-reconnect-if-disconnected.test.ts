import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { WebSocketServer } from 'ws';
import type { Websocket } from '../';
import { ConstantBackoff, WebsocketBuilder, WebsocketEvent } from '../';
import { startServer, stopClient, stopServer } from './websocket-test-utils';

/**
 * Guarantees for reconnectIfDisconnected(), which connectivity signals
 * ('online', 'visibilitychange') and user-activity revival call into:
 *
 * 1. It is a strict no-op while a connection is OPEN or being established —
 *    it must never disturb a healthy connection.
 * 2. It revives a connection whose automatic retries have given up.
 * 3. Multiple signals firing together (e.g. 'online' + 'visibilitychange' on
 *    laptop wake) produce exactly one new connection, never two.
 */
describe('reconnectIfDisconnected()', () => {
  let url: string;
  let server: WebSocketServer | undefined;
  let client: Websocket | undefined;
  let serverConnections = 0;

  beforeEach(async () => {
    serverConnections = 0;
    server = await startServer(0, 5000);
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    url = `ws://localhost:${port}`;
    server.on('connection', () => serverConnections++);
  });

  afterEach(async () => {
    await stopClient(client, 5000);
    await stopServer(server, 5000);
    client = undefined;
    server = undefined;
  });

  const untilOpen = (ws: Websocket) =>
    new Promise<void>((resolve) =>
      ws.addEventListener(WebsocketEvent.Open, () => resolve(), { once: true })
    );

  test('is a no-op on a live connection', async () => {
    let reconnectEvents = 0;
    let retryEvents = 0;

    client = new WebsocketBuilder(url)
      .withBackoff(new ConstantBackoff(100))
      .build();
    client.addEventListener(WebsocketEvent.Reconnect, () => reconnectEvents++);
    client.addEventListener(WebsocketEvent.retry, () => retryEvents++);

    await untilOpen(client);
    const socketBefore = client.underlyingWebsocket;

    client.reconnectIfDisconnected();
    client.reconnectIfDisconnected();
    await new Promise((r) => setTimeout(r, 300));

    // Same underlying socket, still open, no churn, and the server never saw
    // a second connection.
    expect(client.underlyingWebsocket).toBe(socketBefore);
    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.OPEN);
    expect(reconnectEvents).toBe(0);
    expect(retryEvents).toBe(0);
    expect(serverConnections).toBe(1);
    expect(client.send('still-works')).toBe(true);
  });

  test('revives a connection whose retry budget is exhausted', async () => {
    client = new WebsocketBuilder(url)
      .withBackoff(new ConstantBackoff(50))
      .withMaxRetries(0) // first close exhausts the budget immediately
      .build();

    await untilOpen(client);

    // Kill the connection server-side; with maxRetries 0 no retry is scheduled.
    const closed = new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Close, () => resolve(), {
        once: true,
      })
    );
    for (const ws of server!.clients) ws.terminate();
    await closed;
    await new Promise((r) => setTimeout(r, 200));
    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.CLOSED);

    // A revival signal brings it back.
    const reopened = untilOpen(client);
    client.reconnectIfDisconnected();
    await reopened;

    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.OPEN);
    expect(client.send('after-revival')).toBe(true);
    expect(serverConnections).toBe(2);
  });

  test('never revives a websocket the user closed', async () => {
    client = new WebsocketBuilder(url)
      .withBackoff(new ConstantBackoff(50))
      .withMaxRetries(0)
      .build();

    await untilOpen(client);

    const closed = new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Close, () => resolve(), {
        once: true,
      })
    );
    client.close();
    await closed;

    // Late revival signals (a pending pushUpdate resend, an 'online' event
    // racing component cleanup) must not resurrect a deliberately closed
    // socket — that would leak a connection nobody owns.
    client.reconnectIfDisconnected();
    client.reconnectIfDisconnected();
    await new Promise((r) => setTimeout(r, 300));

    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.CLOSED);
    expect(client.closedByUser).toBe(true);
    expect(serverConnections).toBe(1);
  });

  test('simultaneous revival signals create exactly one new connection', async () => {
    // Delay url resolution so the window where a second signal could start a
    // competing connect attempt is wide open.
    const slowResolver = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return url;
    };

    let openEvents = 0;
    client = new WebsocketBuilder(slowResolver)
      .withBackoff(new ConstantBackoff(60_000)) // no auto-retry during the test
      .build();
    client.addEventListener(WebsocketEvent.Open, () => openEvents++);

    await untilOpen(client);

    const closed = new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Close, () => resolve(), {
        once: true,
      })
    );
    for (const ws of server!.clients) ws.terminate();
    await closed;

    // 'online' and 'visibilitychange' firing together on wake, plus a direct
    // reconnect() for good measure — all while the first revival is still
    // resolving its url.
    client.reconnectIfDisconnected();
    client.reconnectIfDisconnected();
    client.reconnect();

    await new Promise((r) => setTimeout(r, 600));

    expect(openEvents).toBe(2); // initial + exactly one revival
    expect(serverConnections).toBe(2);
    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.OPEN);
    expect(client.send('single-connection')).toBe(true);
  }, 10_000);
});
