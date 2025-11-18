import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import {
  ConstantBackoff,
  type Websocket,
  WebsocketBuilder,
  WebsocketEvent,
  type WebsocketEventListenerParams,
} from '../';
import {
  startServerWithHeartbeat,
  stopClient,
  stopServer,
  type WebsocketServerWithHeartbeat,
} from './websocket-test-utils';

describe('Testsuite for Websocket with Heartbeat', () => {
  const serverTimeout: number = process.env.SERVER_TIMEOUT
    ? parseInt(process.env.SERVER_TIMEOUT)
    : 5_000;
  const clientTimeout: number = process.env.CLIENT_TIMEOUT
    ? parseInt(process.env.CLIENT_TIMEOUT)
    : 5_000;
  const testTimeout: number = process.env.TEST_TIMEOUT
    ? parseInt(process.env.TEST_TIMEOUT)
    : 10_000;

  let client: Websocket | undefined; // subject under test
  let server: WebsocketServerWithHeartbeat | undefined; // websocket server used for testing
  let url: string; // dynamically assigned based on server port

  /** Before all tests, log the test configuration. */
  beforeAll(() =>
    console.log(
      `Testing websocket with heartbeat, server timeout: ${serverTimeout}ms, client timeout: ${clientTimeout}ms`
    )
  );

  /** Before each test, start a websocket server on a random port. */
  beforeEach(async () => {
    await stopClient(client, clientTimeout).then(() => {
      client = undefined;
    });
    await stopServer(server, serverTimeout).then(() => {
      server = undefined;
    });
    await startServerWithHeartbeat(0, serverTimeout).then((s) => {
      server = s;
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 41338;
      url = `ws://localhost:${port}`;
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

  test('Websocket should send pings on interval', async () => {
    let [heartbeatsSent, heartbeatsReceived] = [0, 0];
    await new Promise<WebsocketEventListenerParams<WebsocketEvent.Open>>(
      (resolve) => {
        client = new WebsocketBuilder(url)
          .withBackoff(new ConstantBackoff(100)) // retry after 1 second
          .withMaxRetries(Infinity)
          .withHeartbeat({
            timeout: 100,
            interval: 100,
            pingMessage: 'ping',
            pongMessage: 'pong',
            maxMissedHeartbeats: 1,
          })
          .onHeartbeatSent((_, _e) => {
            heartbeatsSent++;
          })
          .onHeartbeatReceived((_, _e) => {
            heartbeatsReceived++;
          })
          .onOpen((instance, ev) => resolve([instance, ev]))
          .build();
      }
    ).then(([instance, ev]) => {
      expect(instance).toBe(client);
      expect(ev.type).toBe(WebsocketEvent.Open);
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(heartbeatsSent).toBeGreaterThan(0);
    expect(heartbeatsReceived).toBeGreaterThan(0);
  });

  test('Websocket should dispatch heartbeatMissed and reconnect when pong not received within timeout', async () => {
    let [heartbeatsSent, heartbeatsReceived, heartbeatMissed] = [0, 0, 0];
    server?.setRespondToPings(false);
    await new Promise<WebsocketEventListenerParams<WebsocketEvent.Reconnect>>(
      (resolve) => {
        client = new WebsocketBuilder(url)
          .withBackoff(new ConstantBackoff(1000))
          .withMaxRetries(Infinity)
          .withHeartbeat({
            timeout: 200,
            interval: 100,
            pingMessage: 'ping',
            pongMessage: 'pong',
            maxMissedHeartbeats: 3,
          })
          .onHeartbeatSent((_, _e) => {
            heartbeatsSent++;
          })
          .onHeartbeatReceived((_i, _ev) => {
            heartbeatsReceived++;
          })
          .onHeartbeatMissed((_i, _ev) => {
            heartbeatMissed++;
          })
          .onReconnect((instance, ev) => {
            resolve([instance, ev]);
          })
          .build();
      }
    ).then(([instance, _ev]) => {
      expect(instance).toBe(client);
    });
    expect(heartbeatsSent).toBeGreaterThan(3);
    expect(heartbeatsReceived).toBe(0);
    expect(heartbeatMissed).toBeGreaterThan(3);
  });

  test('Websocket should reset missed heartbeat counter on successful pong', async () => {
    const missedCounts: number[] = [];

    await new Promise<void>((resolve) => {
      client = new WebsocketBuilder(url)
        .withBackoff(new ConstantBackoff(100))
        .withMaxRetries(Infinity)
        .withHeartbeat({
          timeout: 100,
          interval: 100,
          pingMessage: 'ping',
          pongMessage: 'pong',
          maxMissedHeartbeats: 5,
        })
        .onOpen(() => server!.setRespondToPings(false))
        .onHeartbeatMissed((_, ev) => {
          missedCounts.push(ev.detail.missedHeartbeats);
        })
        .onReconnect(() => {
          server!.setRespondToPings(false);
          setTimeout(resolve, 300);
        })
        .build();
    });

    const restartIndex = missedCounts.lastIndexOf(1);
    expect(restartIndex).toBeGreaterThan(2);
    expect(missedCounts.slice(0, 3)).toEqual([1, 2, 3]);
  });
});
