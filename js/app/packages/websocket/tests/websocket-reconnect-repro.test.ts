import type { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ConstantBackoff, WebsocketBuilder, WebsocketEvent } from '../';
import type { Websocket } from '../';
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

  test(
    'send() works again after a manual reconnect()',
    async () => {
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
    },
    10_000
  );
});
