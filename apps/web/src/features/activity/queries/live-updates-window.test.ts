import type { ActivityEventFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { liveUpdatesGateExchanges } from '@service-storage/graphql-live-updates';
// ast-grep-ignore: ts-feature-layers-use-context -- The test drives the feed through the app's real websocket wiring on purpose.
import * as soupWebsocket from '@service-storage/graphql-soup-websocket';
import {
  createClient,
  type Exchange,
  getOperationName,
  makeResult,
  type Operation,
  subscriptionExchange,
} from '@urql/core';
import { print } from 'graphql';
import { createClient as createWsClient } from 'graphql-ws';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';
import { feedPage } from '../tests/wire';
import { createMyActivityQuery } from './feed-query';
import { createdEvent } from './fixtures';

/** One way, for an HTTP request, a response, or a websocket frame. */
const LATENCY_MS = 10;

type Frame = {
  id?: string;
  type: string;
  payload?: { operationName?: string; data?: unknown };
};

type SocketEvents = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/**
 * The Soup GraphQL server as the first connection sees it: no backlog, so an
 * activity event reaches only the subscriptions registered when it is
 * published. It reads frames in order, registering each subscription as its
 * frame arrives and answering a ping after the frames before it.
 */
function createServer(timing: { acknowledgeAfterMs: number }) {
  const feed: ActivityEventFieldsFragment[] = [];
  const reads: { name: string | null; at: number }[] = [];
  const activitySubscriptions = new Map<FakeSocket, Set<string>>();
  const startedAt = Date.now();

  class FakeSocket implements SocketEvents {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = FakeSocket.CONNECTING;
    onopen: SocketEvents['onopen'] = null;
    onmessage: SocketEvents['onmessage'] = null;
    onclose: SocketEvents['onclose'] = null;
    onerror: SocketEvents['onerror'] = null;

    constructor() {
      setTimeout(() => {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
      }, 2 * LATENCY_MS);
    }

    send(data: string) {
      const frame: Frame = JSON.parse(data);
      setTimeout(() => receive(this, frame), LATENCY_MS);
    }

    deliver(frame: Frame) {
      setTimeout(() => {
        if (this.readyState === FakeSocket.OPEN)
          this.onmessage?.({ data: JSON.stringify(frame) });
      }, LATENCY_MS);
    }

    close(code = 1000, reason = '') {
      if (this.readyState === FakeSocket.CLOSED) return;
      this.readyState = FakeSocket.CLOSED;
      activitySubscriptions.delete(this);
      setTimeout(() => this.onclose?.({ code, reason }), 0);
    }
  }

  function receive(socket: FakeSocket, frame: Frame) {
    if (frame.type === 'connection_init') {
      setTimeout(
        () => socket.deliver({ type: 'connection_ack' }),
        timing.acknowledgeAfterMs
      );
    }
    if (frame.type === 'ping') socket.deliver({ type: 'pong' });
    if (
      frame.type === 'subscribe' &&
      frame.id &&
      frame.payload?.operationName === 'ActivityUpdates'
    ) {
      const ids = activitySubscriptions.get(socket) ?? new Set();
      activitySubscriptions.set(socket, ids.add(frame.id));
    }
    if (frame.type === 'complete' && frame.id)
      activitySubscriptions.get(socket)?.delete(frame.id);
  }

  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** The HTTP transport: each read sees the feed as it is on arrival. */
  const httpExchange: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation: Operation) =>
        fromPromise(
          (async () => {
            await wait(LATENCY_MS);
            const name = getOperationName(operation.query) ?? null;
            reads.push({ name, at: Date.now() - startedAt });
            const page = feedPage([...feed]);
            await wait(LATENCY_MS);
            return makeResult(operation, { data: page });
          })()
        )
      )
    );

  return {
    FakeSocket,
    httpExchange,
    reads: () => reads.map(({ name }) => name),
    /** Another tab or teammate acts: the server records it and pushes it. */
    publish(event: ActivityEventFieldsFragment) {
      feed.unshift(event);
      for (const [socket, ids] of activitySubscriptions) {
        for (const id of ids)
          socket.deliver({
            id,
            type: 'next',
            payload: { data: { activityUpdates: event } },
          });
      }
    },
  };
}

const disposals: Array<() => void> = [];

/**
 * The app's Soup client on its first connection: the real subscriptions
 * lifecycle and websocket events over a real graphql-ws client, with the
 * live-updates gate before the transports, or without it to show what it
 * closes. The gate holds each read, as the cached client does behind a cached
 * result, or with `cached: false` sends it at once and again once live, as
 * the uncached client and a cache miss do.
 */
function startApp(options: {
  gated: boolean;
  cached?: boolean;
  acknowledgeAfterMs: number;
}) {
  const server = createServer(options);
  const lifecycle = soupWebsocket.createGraphqlSoupSubscriptionsLifecycle();
  const websocket = createWsClient({
    url: 'wss://dss.test/items/soup/graphql/ws',
    webSocketImpl: server.FakeSocket,
    retryAttempts: 0,
    on: soupWebsocket.createGraphqlSoupWebSocketEvents({
      terminate: () => websocket.terminate(),
      lifecycle,
    }),
  });
  const subscriptions = subscriptionExchange({
    forwardSubscription: (payload, operation) => ({
      subscribe(sink) {
        const unsubscribe = websocket.subscribe(
          {
            query: print(operation.query),
            operationName: payload.operationName,
            variables: payload.variables,
          },
          sink
        );
        return { unsubscribe };
      },
    }),
  });
  const live = liveUpdatesGateExchanges(lifecycle.liveUpdates, {
    cached: options.cached,
  });
  const client = createClient({
    url: 'https://dss.test/items/soup/graphql',
    exchanges: [
      ...(options.gated ? [live.rereads, live.holds] : []),
      subscriptions,
      server.httpExchange,
    ],
  });
  lifecycle.replace(client);
  const feed = createRoot((dispose) => {
    disposals.push(dispose);
    return createMyActivityQuery(
      { graphql: () => client },
      { scope: 'mine', enabled: () => true }
    );
  });
  disposals.push(() => {
    lifecycle.dispose();
    websocket.terminate();
  });
  return {
    server,
    feedIds: () =>
      feed.isSuccess ? (feed.data ?? []).map(({ id }) => id) : [],
  };
}

const event = (id: string) => ({ ...createdEvent, id });

// The first connection's subscriptions start about 70ms after load here: the
// socket opens, the server acknowledges it 20ms later, and the subscribe
// frames arrive. An ungated feed read is answered from the server at 10ms.
const ACKNOWLEDGE_AFTER_MS = 20;
const IN_THE_WINDOW_MS = 40;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
});

describe('the first connection', () => {
  it('shows an event published before its subscriptions start, with one read', async () => {
    const app = startApp({
      gated: true,
      acknowledgeAfterMs: ACKNOWLEDGE_AFTER_MS,
    });
    await vi.advanceTimersByTimeAsync(IN_THE_WINDOW_MS);
    app.server.publish(event('in-the-window'));

    // Past the activity push debounce: nothing else would read again.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(app.feedIds()).toEqual(['in-the-window']);
    expect(app.server.reads()).toEqual(['MyActivity']);
  });

  it('shows that event with nothing cached, from a read sent at once and again once live', async () => {
    const app = startApp({
      gated: true,
      cached: false,
      acknowledgeAfterMs: ACKNOWLEDGE_AFTER_MS,
    });
    await vi.advanceTimersByTimeAsync(IN_THE_WINDOW_MS);
    // Answered before the subscriptions start, as without the gate.
    expect(app.server.reads()).toEqual(['MyActivity']);
    app.server.publish(event('in-the-window'));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(app.feedIds()).toEqual(['in-the-window']);
    expect(app.server.reads()).toEqual(['MyActivity', 'MyActivity']);
  });

  it('loses that event without the gate, which is the window', async () => {
    const app = startApp({
      gated: false,
      acknowledgeAfterMs: ACKNOWLEDGE_AFTER_MS,
    });
    await vi.advanceTimersByTimeAsync(IN_THE_WINDOW_MS);
    app.server.publish(event('in-the-window'));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(app.feedIds()).toEqual([]);
    expect(app.server.reads()).toEqual(['MyActivity']);
  });

  it('shows an event published once its subscriptions are live', async () => {
    const app = startApp({
      gated: true,
      acknowledgeAfterMs: ACKNOWLEDGE_AFTER_MS,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(app.server.reads()).toEqual(['MyActivity']);
    app.server.publish(event('after-live'));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(app.feedIds()).toEqual(['after-live']);
    expect(app.server.reads()).toEqual(['MyActivity', 'MyActivity']);
  });

  it('reads again once live when the socket outlasts the hold', async () => {
    const app = startApp({ gated: true, acknowledgeAfterMs: 1_500 });
    await vi.advanceTimersByTimeAsync(1_200);
    // The hold gave up at 1s; this read did not wait for the subscriptions.
    expect(app.server.reads()).toEqual(['MyActivity']);
    app.server.publish(event('in-a-long-window'));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.feedIds()).toEqual(['in-a-long-window']);
    expect(app.server.reads()).toEqual(['MyActivity', 'MyActivity']);
  });
});
