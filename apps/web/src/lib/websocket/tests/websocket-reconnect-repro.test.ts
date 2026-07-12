import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { WebSocketServer } from 'ws';
import type { Websocket } from '../';
import { ConstantBackoff, WebsocketBuilder, WebsocketEvent } from '../';
import { startServer, stopClient, stopServer } from './websocket-test-utils';

/**
 * Regression test for the "connected but messages don't send" bug.
 *
 * `Websocket.reconnect()` used to call `close()`, which set
 * `_closedByUser = true` permanently: the new underlying socket opened fine
 * (UI showed connected), but `send()` short-circuited on `closedByUser` and
 * silently dropped every message. The sync engine calls `reconnect()` when an
 * update ack times out, so one missed ack zombified the connection and every
 * subsequent edit triggered another missed ack -> reconnect -> loop.
 */
describe('reconnect() should produce a usable connection', () => {
  let url: string;
  let server: WebSocketServer | undefined;
  let client: Websocket | undefined;

  beforeEach(async () => {
    server = await startServer(0, 5000);
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    url = `ws://localhost:${port}`;
  });

  afterEach(async () => {
    await stopClient(client, 5000);
    await stopServer(server, 5000);
    client = undefined;
    server = undefined;
  });

  test('explicit reconnect() revives a close() that landed during url resolution', async () => {
    const received: string[] = [];
    let connections = 0;
    server!.on('connection', (ws) => {
      connections++;
      ws.on('message', (data) => received.push(data.toString()));
    });

    // Slow url resolution keeps connectPending true long enough for both
    // calls below to land inside the same in-flight connect attempt.
    const slowResolver = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return url;
    };

    client = new WebsocketBuilder(slowResolver)
      .withBackoff(new ConstantBackoff(100))
      .build();

    // close() while the first connect attempt is still resolving its url,
    // then an explicit reconnect() in the same window. The reconnect must
    // override the close by adopting the in-flight attempt — not be
    // silently swallowed by the connect-pending guard.
    client.close();
    client.reconnect();

    await Promise.race([
      new Promise<void>((resolve) =>
        client!.addEventListener(WebsocketEvent.Open, () => resolve(), {
          once: true,
        })
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('socket was never revived')), 3000)
      ),
    ]);

    expect(client.closedByUser).toBe(false);
    expect(client.send('revived')).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toContain('revived');
    // The pending attempt was adopted, not duplicated.
    expect(connections).toBe(1);
  }, 10_000);

  test('send() works again after a manual reconnect()', async () => {
    const received: string[] = [];
    server!.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()));
    });

    client = new WebsocketBuilder(url)
      .withBackoff(new ConstantBackoff(100))
      .build();

    await new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Open, () => resolve(), {
        once: true,
      })
    );

    expect(client.send('before-reconnect')).toBe(true);

    // what engine.ts does on a missed ack
    client.reconnect();

    await new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Open, () => resolve(), {
        once: true,
      })
    );

    expect(client.underlyingWebsocket.readyState).toBe(WebSocket.OPEN);

    // A reconnected socket must be able to send.
    const sent = client.send('after-reconnect');
    await new Promise((r) => setTimeout(r, 250));

    expect(sent).toBe(true);
    expect(received).toContain('after-reconnect');
    expect(client.closedByUser).toBe(false);
  }, 10_000);
});
