import { createClient } from 'graphql-ws';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ReplayEnvelope = { seq: number; message: { type: string; data: unknown } };
type ConnectArgs = {
  url: string;
  onMessage: { onmessage?: (envelope: ReplayEnvelope) => void };
  config?: { headers: [string, string][] };
};

// A native websocket plugin that speaks graphql-transport-ws as the server.
const plugin = vi.hoisted(() => ({
  connects: [] as ConnectArgs[],
  received: [] as Array<{ id: number; type: string; payload: unknown }>,
  // Connections the network dropped without a close frame: still open on the
  // client, never answered.
  silent: new Set<number>(),
  // Subscriptions answer once and stay open instead of completing.
  live: false,
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage?: (envelope: ReplayEnvelope) => void;
  },
  invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === 'plugin:websocket|connect') {
      plugin.connects.push(args as ConnectArgs);
      return plugin.connects.length;
    }
    // Nothing reached the native side that the webview did not hear.
    if (command === 'plugin:websocket|recover')
      return { messages: [], gap: false };
    if (command !== 'plugin:websocket|send') return;
    const id = args.id as number;
    const message = args.message as { type: string; data: unknown };
    if (message.type !== 'Text') {
      plugin.received.push({ id, type: message.type, payload: message.data });
      return;
    }
    const frame = JSON.parse(message.data as string);
    plugin.received.push({ id, type: frame.type, payload: frame.payload });
    if (plugin.silent.has(id)) return;
    const channel = plugin.connects[id - 1]?.onMessage;
    let seq = plugin.received.length;
    const reply = (value: object) =>
      queueMicrotask(() =>
        channel?.onmessage?.({
          seq: ++seq,
          message: { type: 'Text', data: JSON.stringify(value) },
        })
      );
    if (frame.type === 'connection_init') reply({ type: 'connection_ack' });
    if (frame.type === 'ping') reply({ type: 'pong' });
    if (frame.type === 'subscribe') {
      reply({ id: frame.id, type: 'next', payload: { data: { ping: id } } });
      if (!plugin.live) reply({ id: frame.id, type: 'complete' });
    }
  }),
}));

import { TauriWebSocketWrapper } from '@macro-inc/collaboration/websocket/platform/tauri-websocket';
import {
  createGraphqlSoupWebSocketLiveness,
  createGraphqlSoupWebSocketUrlResolver,
  GRAPHQL_SOUP_WEBSOCKET_PONG_TIMEOUT_MS,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  shouldRetryGraphqlSoupWebSocket,
} from './graphql-soup-websocket';

function subscribeOnce(client: ReturnType<typeof createClient>) {
  return new Promise<unknown[]>((resolve, reject) => {
    const values: unknown[] = [];
    client.subscribe(
      { query: 'subscription { ping }' },
      {
        next: (value) => values.push(value),
        error: reject,
        complete: () => resolve(values),
      }
    );
    // An unhandled url rejection used to leave the subscription pending.
    setTimeout(() => reject(new Error('subscription stayed pending')), 1_000);
  });
}

function cookieClient(refreshCookieAuth: () => Promise<unknown>) {
  return createClient({
    url: createGraphqlSoupWebSocketUrlResolver({
      dssHost: 'https://dss.test',
      bearerTokenAuth: false,
      getApiToken: vi.fn(),
      refreshCookieAuth: refreshCookieAuth as never,
    }),
    webSocketImpl: TauriWebSocketWrapper,
    retryAttempts: SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
    retryWait: async () => {},
    shouldRetry: shouldRetryGraphqlSoupWebSocket,
  });
}

beforeEach(() => {
  plugin.connects.length = 0;
  plugin.received.length = 0;
  plugin.silent.clear();
  plugin.live = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GraphQL websocket auth recovery', () => {
  it('retries a cookie refresh that failed during an outage', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(err([{ code: 'NETWORK_ERROR' }]))
      .mockResolvedValue(ok(undefined));
    const client = cookieClient(refresh);

    await expect(subscribeOnce(client)).resolves.toEqual([
      { data: { ping: 1 } },
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
    await client.dispose();
  });

  it('ends subscriptions when the session is rejected', async () => {
    const client = cookieClient(
      vi.fn().mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]))
    );

    await expect(subscribeOnce(client)).rejects.toThrow(
      'GraphQL websocket session was rejected'
    );
    expect(plugin.connects).toHaveLength(0);
    await client.dispose();
  });
});

describe('GraphQL websocket over the native transport', () => {
  it('negotiates graphql-transport-ws and runs a subscription', async () => {
    const client = cookieClient(vi.fn().mockResolvedValue(ok(undefined)));

    await expect(subscribeOnce(client)).resolves.toEqual([
      { data: { ping: 1 } },
    ]);
    expect(plugin.connects[0]?.url).toBe(
      'wss://dss.test/items/soup/graphql/ws'
    );
    expect(plugin.connects[0]?.config).toEqual({
      headers: [['Sec-WebSocket-Protocol', 'graphql-transport-ws']],
    });
    expect(plugin.received.map(({ type }) => type)).toEqual([
      'connection_init',
      'subscribe',
      'Close',
    ]);
    await client.dispose();
  });

  it('reconnects after the idle socket closes', async () => {
    const client = cookieClient(vi.fn().mockResolvedValue(ok(undefined)));

    await subscribeOnce(client);
    // The lazy client closed its idle socket; the next subscription must
    // open a new one rather than reuse the closed socket.
    await expect(subscribeOnce(client)).resolves.toEqual([
      { data: { ping: 2 } },
    ]);
    expect(plugin.connects).toHaveLength(2);
    await client.dispose();
  });
});

describe('GraphQL websocket liveness on resume', () => {
  // Wired as createGraphqlSoupWebSocketClient wires it.
  function livenessClient() {
    const connected: boolean[] = [];
    const liveness = createGraphqlSoupWebSocketLiveness(() =>
      client.terminate()
    );
    const client = createClient({
      url: 'wss://dss.test/items/soup/graphql/ws',
      webSocketImpl: TauriWebSocketWrapper,
      retryAttempts: SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
      retryWait: async () => {},
      shouldRetry: shouldRetryGraphqlSoupWebSocket,
      on: {
        closed: () => liveness.closed(),
        pong: liveness.pong,
        connected: (socket, _payload, wasRetry) => {
          liveness.connected(socket);
          connected.push(wasRetry);
        },
      },
    });
    return { client, connected };
  }

  function follow(client: ReturnType<typeof createClient>) {
    const values: unknown[] = [];
    const errors: unknown[] = [];
    const unsubscribe = client.subscribe(
      { query: 'subscription { ping }' },
      {
        next: (value) => values.push(value),
        error: (error) => errors.push(error),
        complete: () => undefined,
      }
    );
    return { values, errors, unsubscribe };
  }

  function returnToForeground() {
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('reconnects a socket that stopped answering while the app slept', async () => {
    vi.useFakeTimers();
    plugin.live = true;
    const { client, connected } = livenessClient();
    const subscription = follow(client);
    await vi.waitFor(() =>
      expect(subscription.values).toEqual([{ data: { ping: 1 } }])
    );

    plugin.silent.add(1);
    returnToForeground();
    expect(plugin.received.at(-1)?.type).toBe('ping');
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_WEBSOCKET_PONG_TIMEOUT_MS);

    await vi.waitFor(() =>
      expect(subscription.values).toEqual([
        { data: { ping: 1 } },
        { data: { ping: 2 } },
      ])
    );
    expect(connected).toEqual([false, true]);
    expect(subscription.errors).toEqual([]);
    subscription.unsubscribe();
    await client.dispose();
  });

  it('keeps a socket that answers', async () => {
    vi.useFakeTimers();
    plugin.live = true;
    const { client, connected } = livenessClient();
    const subscription = follow(client);
    await vi.waitFor(() =>
      expect(subscription.values).toEqual([{ data: { ping: 1 } }])
    );

    returnToForeground();
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_WEBSOCKET_PONG_TIMEOUT_MS);

    expect(plugin.connects).toHaveLength(1);
    expect(connected).toEqual([false]);
    subscription.unsubscribe();
    await client.dispose();
  });
});
