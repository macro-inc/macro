import { isMobile } from '@core/mobile/isMobile';
import { ThrownResultError } from '@core/util/result';
import type { ClientOptions } from 'graphql-ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGraphqlSoupConnection,
  type GraphqlSoupConnection,
} from './graphql-soup-connection';
import {
  pauseGraphqlSoupRealtimeSession,
  restartGraphqlSoupRealtimeSession,
} from './graphql-soup-realtime-session';

const telemetry = vi.hoisted(() => vi.fn());
vi.mock('@core/mobile/isMobile', () => ({ isMobile: vi.fn(() => false) }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: { info: telemetry } }));
vi.mock('graphql-ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql-ws')>();
  let nextId = 0;
  return {
    ...actual,
    // Backoff jitter uses a fixed random value in these tests; keep the
    // protocol's operation IDs distinct while exercising the real client.
    createClient: (options: ClientOptions) =>
      actual.createClient({
        ...options,
        generateID: () => String(++nextId),
      }),
  };
});

class TestSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = TestSocket.CONNECTING;
  onopen?: () => Promise<void>;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: CloseEvent) => void;
  onerror?: (event: Event) => void;
  sent: Array<{ type: string; id?: string; payload?: unknown }> = [];

  constructor(readonly url: string) {
    TestSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = 'closed') {
    if (this.readyState === TestSocket.CLOSED) return;
    this.readyState = TestSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  async acknowledge() {
    this.readyState = TestSocket.OPEN;
    await this.onopen?.();
    this.receive({ type: 'connection_ack' });
    await vi.advanceTimersByTimeAsync(0);
  }
}

const connections: GraphqlSoupConnection[] = [];
function setup(resolveUrl = vi.fn(async () => 'ws://live.test')) {
  const onConnected = vi.fn();
  const onAuthTimeout = vi.fn();
  const connection = createGraphqlSoupConnection({
    resolveUrl,
    onConnected,
    onAuthTimeout,
    webSocketImpl: TestSocket as unknown as typeof WebSocket,
  });
  connections.push(connection);
  const sink = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  const unsubscribe = connection.subscribe(
    {
      query: 'subscription Updates { updates }',
      operationName: 'Updates',
    },
    sink
  );
  return {
    connection,
    sink,
    unsubscribe,
    resolveUrl,
    onConnected,
    onAuthTimeout,
  };
}

async function socket() {
  await vi.advanceTimersByTimeAsync(0);
  const latest = TestSocket.instances.at(-1);
  if (!latest) throw new Error('Expected a connection attempt');
  return latest;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.mocked(isMobile).mockReturnValue(false);
  TestSocket.instances = [];
  telemetry.mockClear();
  restartGraphqlSoupRealtimeSession();
});

afterEach(() => {
  for (const connection of connections.splice(0)) connection.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('silent GraphQL live connection recovery', () => {
  it('recovers beyond five failed attempts, refreshes auth, and retains the same sink', async () => {
    const { resolveUrl, sink, onConnected } = setup();
    for (let failures = 0; failures < 8; failures++) {
      (await socket()).close(1006);
      await vi.advanceTimersByTimeAsync(
        Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) * 0.8
      );
    }
    const live = await socket();
    await live.acknowledge();
    const subscription = live.sent.find(({ type }) => type === 'subscribe');
    live.receive({
      type: 'next',
      id: subscription?.id,
      payload: { data: { updates: 'restored' } },
    });
    expect(resolveUrl).toHaveBeenCalledTimes(9);
    expect(onConnected).toHaveBeenCalledOnce();
    expect(sink.next).toHaveBeenCalledWith({ data: { updates: 'restored' } });
    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.complete).not.toHaveBeenCalled();
  });

  it('restores each subscriber once and leaves unsubscribed operations removed', async () => {
    const { connection, sink, unsubscribe, onConnected } = setup();
    const second = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
    connection.subscribe({ query: 'subscription Other { other }' }, second);
    const first = await socket();
    await first.acknowledge();
    expect(first.sent.filter(({ type }) => type === 'subscribe')).toHaveLength(
      2
    );
    unsubscribe();
    first.close(1006);
    await vi.advanceTimersByTimeAsync(800);
    const restored = await socket();
    await restored.acknowledge();
    expect(
      restored.sent.filter(({ type }) => type === 'subscribe')
    ).toHaveLength(1);
    expect(sink.next).not.toHaveBeenCalled();
    expect(onConnected.mock.calls).toEqual([[false], [true]]);
  });

  it('pauses mobile in the background and coalesces foreground and online recovery', async () => {
    vi.mocked(isMobile).mockReturnValue(true);
    setup();
    const first = await socket();
    await first.acknowledge();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(first.readyState).toBe(TestSocket.CLOSED);
    expect(TestSocket.instances).toHaveLength(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(await socket()).not.toBe(first);
    expect(TestSocket.instances).toHaveLength(2);
  });

  it('keeps desktop notification patches live while hidden without reconnecting on foreground', async () => {
    const { sink, onConnected } = setup();
    const live = await socket();
    await live.acknowledge();
    const subscription = live.sent.find(({ type }) => type === 'subscribe');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(live.readyState).toBe(TestSocket.OPEN);
    live.receive({
      type: 'next',
      id: subscription?.id,
      payload: { data: { updates: 'background patch' } },
    });
    expect(sink.next).toHaveBeenCalledWith({
      data: { updates: 'background patch' },
    });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(TestSocket.instances).toHaveLength(1);
    expect(onConnected.mock.calls).toEqual([[false]]);
  });

  it('retries transient desktop failures while hidden', async () => {
    const { sink, onConnected } = setup();
    await (await socket()).acknowledge();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    (await socket()).close(1006);
    await vi.advanceTimersByTimeAsync(800);
    const recovered = await socket();
    await recovered.acknowledge();
    const subscription = recovered.sent.find(
      ({ type }) => type === 'subscribe'
    );
    recovered.receive({
      type: 'next',
      id: subscription?.id,
      payload: { data: { updates: 'recovered background patch' } },
    });
    expect(sink.next).toHaveBeenCalledWith({
      data: { updates: 'recovered background patch' },
    });
    expect(TestSocket.instances).toHaveLength(2);
    expect(onConnected.mock.calls).toEqual([[false], [true]]);
  });

  it('bypasses backoff when connectivity returns, even if navigator reports offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    (await socket()).close(1006);
    window.dispatchEvent(new Event('online'));
    await socket();
    expect(TestSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(TestSocket.instances).toHaveLength(2);
  });

  it.each(['NETWORK_ERROR', 'SERVER_ERROR', 'HTTP_ERROR'])(
    'retries a caught %s authentication failure',
    async (code) => {
      const resolveUrl = vi
        .fn(async () => 'ws://live.test')
        .mockRejectedValueOnce(
          new ThrownResultError([{ code, message: 'request failed' }])
        );
      const { sink } = setup(resolveUrl);
      await vi.advanceTimersByTimeAsync(800);
      await (await socket()).acknowledge();
      expect(resolveUrl).toHaveBeenCalledTimes(2);
      expect(sink.error).not.toHaveBeenCalled();
    }
  );

  it('blocks definitive authentication failure until a fresh login', async () => {
    const resolveUrl = vi
      .fn(async () => 'ws://fresh.test')
      .mockRejectedValueOnce(
        new ThrownResultError([{ code: 'UNAUTHORIZED', message: 'rejected' }])
      );
    setup(resolveUrl);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveUrl).toHaveBeenCalledOnce();
    restartGraphqlSoupRealtimeSession();
    await (await socket()).acknowledge();
    expect(resolveUrl).toHaveBeenCalledTimes(2);
  });

  it('times out hung authentication and ignores its late result', async () => {
    let resolve!: (url: string) => void;
    const resolveUrl = vi
      .fn(async () => 'ws://fresh.test')
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          })
      );
    const { onAuthTimeout } = setup(resolveUrl);
    await vi.advanceTimersByTimeAsync(15_800);
    expect(onAuthTimeout).toHaveBeenCalledOnce();
    expect((await socket()).url).toBe('ws://fresh.test');
    resolve('ws://retired.test');
    await vi.advanceTimersByTimeAsync(0);
    expect(TestSocket.instances).toHaveLength(1);
  });

  it('replaces a socket that never acknowledges the connection', async () => {
    setup();
    const first = await socket();
    await vi.advanceTimersByTimeAsync(10_800);
    expect(first.readyState).toBe(TestSocket.CLOSED);
    expect(TestSocket.instances).toHaveLength(2);
    await (await socket()).acknowledge();
  });

  it('replaces a frozen socket when a heartbeat receives no pong', async () => {
    setup();
    const first = await socket();
    await first.acknowledge();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(first.sent.at(-1)?.type).toBe('ping');
    await vi.advanceTimersByTimeAsync(10_800);
    expect(first.readyState).toBe(TestSocket.CLOSED);
    expect(TestSocket.instances).toHaveLength(2);
  });

  it('keeps a healthy connection when heartbeats receive pong', async () => {
    setup();
    const live = await socket();
    await live.acknowledge();
    for (let heartbeat = 0; heartbeat < 3; heartbeat++) {
      await vi.advanceTimersByTimeAsync(20_000);
      live.receive({ type: 'pong' });
    }
    expect(live.readyState).toBe(TestSocket.OPEN);
    expect(TestSocket.instances).toHaveLength(1);
  });

  it.each(['error', 'next'])(
    'retries a retryable %s frame without replacing healthy siblings',
    async (frame) => {
      const { connection } = setup();
      connection.subscribe(
        { query: 'subscription Other { other }' },
        { next: vi.fn(), error: vi.fn(), complete: vi.fn() }
      );
      const live = await socket();
      await live.acknowledge();
      const subscription = live.sent.find(({ type }) => type === 'subscribe');
      live.receive({
        type: frame,
        id: subscription?.id,
        payload:
          frame === 'error'
            ? [{ message: 'transient', extensions: { retryable: true } }]
            : {
                errors: [
                  { message: 'transient', extensions: { retryable: true } },
                ],
              },
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(live.sent.filter(({ type }) => type === 'subscribe')).toHaveLength(
        3
      );
      expect(TestSocket.instances).toHaveLength(1);
    }
  );

  it('keeps a nonretryable operation failure from stopping healthy siblings', async () => {
    const { connection, sink } = setup();
    const second = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
    connection.subscribe({ query: 'subscription Other { other }' }, second);
    const live = await socket();
    await live.acknowledge();
    const requests = live.sent.filter(({ type }) => type === 'subscribe');
    live.receive({
      type: 'error',
      id: requests[0].id,
      payload: [{ message: 'invalid operation' }],
    });
    live.receive({
      type: 'next',
      id: requests[1].id,
      payload: { data: { other: true } },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(live.sent.filter(({ type }) => type === 'subscribe')).toHaveLength(
      2
    );
    expect(second.next).toHaveBeenCalledOnce();
    expect(sink.error).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledWith(
      'graphql_soup.ws.subscription_failed',
      expect.objectContaining({ 'ws.retryable': false })
    );
  });

  it('fences old deliveries and retries across logout and login', async () => {
    const { sink } = setup();
    const first = await socket();
    await first.acknowledge();
    const deliver = first.onmessage;
    const request = first.sent.find(({ type }) => type === 'subscribe');
    pauseGraphqlSoupRealtimeSession();
    deliver?.({
      data: JSON.stringify({
        type: 'next',
        id: request?.id,
        payload: { data: { updates: 'old-account' } },
      }),
    });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sink.next).not.toHaveBeenCalled();
    expect(TestSocket.instances).toHaveLength(1);
    restartGraphqlSoupRealtimeSession();
    await (await socket()).acknowledge();
    expect(TestSocket.instances).toHaveLength(2);
  });

  it('disposes timers and listeners even while authentication is pending', async () => {
    let resolve!: (url: string) => void;
    const { connection, resolveUrl } = setup(
      vi.fn(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          })
      )
    );
    connection.dispose();
    resolve('ws://retired.test');
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resolveUrl).toHaveBeenCalledOnce();
    expect(TestSocket.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
