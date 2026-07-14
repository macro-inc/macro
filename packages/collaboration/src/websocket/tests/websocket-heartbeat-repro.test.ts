import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ConstantBackoff,
  type Websocket,
  WebsocketBuilder,
  WebsocketEvent,
} from '../';
import {
  startServerWithHeartbeat,
  stopClient,
  stopServer,
  type WebsocketServerWithHeartbeat,
} from './websocket-test-utils';

/**
 * Regression test for intermittent disconnects on long-lived, otherwise
 * healthy connections.
 *
 * `missedHeartbeats` used to be incremented in handleHeartbeatTimeout() but
 * never reset when a pong WAS received, so the counter accumulated over the
 * lifetime of a connection: with maxMissedHeartbeats = 2 (the sync-service
 * config), the 3rd missed pong — even with hours of healthy ping/pong in
 * between — force-closed a healthy connection ("No heartbeat received").
 * Only consecutive misses should close the connection.
 */
describe('missed heartbeats should reset on received pong', () => {
  let client: Websocket | undefined;
  let server: WebsocketServerWithHeartbeat | undefined;
  let url: string;

  beforeEach(async () => {
    server = await startServerWithHeartbeat(0, 5000);
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

  test('non-consecutive misses, each recovered, do not close the connection', async () => {
    const missed: number[] = [];
    let closed = false;

    client = new WebsocketBuilder(url)
      .withBackoff(new ConstantBackoff(60_000)) // don't reconnect during test
      .withHeartbeat({
        interval: 150,
        timeout: 80,
        pingMessage: 'ping',
        pongMessage: 'pong',
        maxMissedHeartbeats: 2,
      })
      .build();

    client.addEventListener(WebsocketEvent.HeartbeatMissed, (_w, e) => {
      missed.push((e as CustomEvent).detail.missedHeartbeats);
    });
    client.addEventListener(WebsocketEvent.Close, () => {
      closed = true;
    });

    await new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Open, () => resolve(), {
        once: true,
      })
    );

    const missOne = async () => {
      server!.setRespondToPings(false);
      const target = missed.length + 1;
      while (missed.length < target) {
        await new Promise((r) => setTimeout(r, 20));
      }
      server!.setRespondToPings(true);
      // several healthy ping/pong cycles — these pongs should reset the
      // missed-heartbeat counter
      await new Promise((r) => setTimeout(r, 500));
    };

    await missOne(); // isolated miss #1, recovered
    expect(closed).toBe(false);
    await missOne(); // isolated miss #2, recovered
    expect(closed).toBe(false);
    await missOne(); // isolated miss #3, recovered
    await new Promise((r) => setTimeout(r, 300));

    // Each miss was followed by healthy pongs, so the counter reset and the
    // connection stays open. Without the reset the counter accumulated
    // 1, 2, 3 and the third isolated miss closed the connection.
    expect(closed).toBe(false);
    // Every recorded miss is an isolated first miss, never a streak.
    expect(missed.every((m) => m === 1)).toBe(true);
  }, 20_000);
});
