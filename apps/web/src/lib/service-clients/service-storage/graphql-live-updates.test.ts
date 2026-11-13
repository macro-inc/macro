import {
  type Client,
  createClient,
  createRequest,
  type Exchange,
  getOperationName,
  gql,
  makeResult,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filter,
  makeSubject,
  map,
  merge,
  onPush,
  pipe,
  subscribe,
} from 'wonka';
import { normalizedCacheExchange } from '../../graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '../../graphql-cache/host/noop-host';
import {
  firstRequestIn,
  TRACE_PARENT_CONTEXT_KEY,
} from '../../urql-solid/trace-parent-exchange';

type RecordedSpan = {
  name: string;
  parent: string | undefined;
  attributes: Record<string, unknown>;
  ended: boolean;
};

const telemetry = vi.hoisted(() => ({
  active: [] as string[],
  spans: [] as RecordedSpan[],
}));

function within<T>(name: string, work: () => T): T {
  telemetry.active.push(name);
  try {
    return work();
  } finally {
    telemetry.active.pop();
  }
}

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      name: string,
      options: { attributes?: Record<string, unknown> } = {}
    ) => {
      const span: RecordedSpan = {
        name,
        parent: telemetry.active.at(-1),
        attributes: { ...options.attributes },
        ended: false,
      };
      telemetry.spans.push(span);
      return {
        setAttr: (key: string, value: unknown) => {
          span.attributes[key] = value;
        },
        end: () => {
          span.ended = true;
        },
        run: <T>(work: () => T): T => within(name, work),
      };
    },
    captureContext: () => {
      const captured = telemetry.active.at(-1);
      return {
        run: <T>(work: () => T): T =>
          captured ? within(captured, work) : work(),
      };
    },
  },
}));

import {
  createLiveUpdatesGate,
  FOLLOWS_LIVE_UPDATES,
  LIVE_UPDATES_HOLD_MS,
  type LiveUpdatesGate,
  liveUpdatesGateExchange,
} from './graphql-live-updates';

const FEED = gql`
  query Feed {
    feed {
      id
    }
  }
`;
const OTHER = gql`
  query Other {
    other {
      id
    }
  }
`;
const RENAME = gql`
  mutation Rename {
    rename {
      id
    }
  }
`;

beforeEach(() => {
  vi.useFakeTimers();
  telemetry.spans.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/** A gate whose first connection has been acknowledged and pinged. */
async function pingedGate(onLive = vi.fn()) {
  const gate = createLiveUpdatesGate({ onLive });
  gate.connected(() => true);
  await vi.advanceTimersByTimeAsync(0);
  return { gate, onLive };
}

describe('createLiveUpdatesGate', () => {
  it('opens on the pong to a ping sent a task after the connection', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const ping = vi.fn(() => true);
    gate.connected(ping);
    // The subscribe frames go out in the microtasks after the acknowledgement.
    expect(ping).not.toHaveBeenCalled();
    gate.pong(true);
    expect(gate.holding()).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(ping).toHaveBeenCalledOnce();
    // graphql-ws reports its own pongs as not received.
    gate.pong(false);
    expect(gate.holding()).toBe(true);
    gate.pong(true);

    expect(gate.holding()).toBe(false);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set());
  });

  it('tells which held reads it sent as it went live', async () => {
    const { gate, onLive } = await pingedGate();
    const first = vi.fn();
    const second = vi.fn();
    gate.hold(1, first);
    gate.hold(2, second);
    const cancel = gate.hold(3, vi.fn());
    cancel();
    gate.pong(true);
    expect(first).toHaveBeenCalledExactlyOnceWith('live');
    expect(second).toHaveBeenCalledExactlyOnceWith('live');
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set([1, 2]));
  });

  it('releases held reads at the bound and marks them stale once live', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const resume = vi.fn();
    gate.hold(1, resume);

    await vi.advanceTimersByTimeAsync(LIVE_UPDATES_HOLD_MS);
    expect(resume).toHaveBeenCalledExactlyOnceWith('timed_out');
    expect(gate.holding()).toBe(false);

    gate.connected(() => true);
    await vi.advanceTimersByTimeAsync(0);
    gate.pong(true);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(true, new Set());
  });

  it('starts the bound at the first held read', async () => {
    const gate = createLiveUpdatesGate({ onLive: vi.fn() });
    const first = vi.fn();
    const second = vi.fn();
    gate.hold(1, first);
    await vi.advanceTimersByTimeAsync(LIVE_UPDATES_HOLD_MS - 1);
    gate.hold(2, second);
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledWith('timed_out');
    expect(second).toHaveBeenCalledWith('timed_out');
  });

  it('goes live unverified when the socket cannot be pinged', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const resume = vi.fn();
    gate.hold(1, resume);
    gate.connected(() => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenCalledExactlyOnceWith('unverified');
    expect(onLive).toHaveBeenCalledExactlyOnceWith(true, new Set([1]));
  });

  it('pings the next connection when the first closes before its ping', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const first = vi.fn(() => true);
    gate.connected(first);
    gate.closed();
    const second = vi.fn(() => true);
    gate.connected(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    gate.pong(true);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set());
  });

  it('ignores a pong on a connection that closed after its ping', async () => {
    const { gate, onLive } = await pingedGate();
    gate.closed();
    gate.pong(true);
    expect(gate.holding()).toBe(true);
    expect(onLive).not.toHaveBeenCalled();
  });

  it('stays live across later connections', async () => {
    const { gate, onLive } = await pingedGate();
    gate.pong(true);
    const ping = vi.fn(() => true);
    gate.connected(ping);
    await vi.advanceTimersByTimeAsync(0);
    gate.pong(true);
    expect(ping).not.toHaveBeenCalled();
    expect(onLive).toHaveBeenCalledOnce();
  });

  it('releases held reads on dispose without going live', async () => {
    const { gate, onLive } = await pingedGate();
    const resume = vi.fn();
    const settle = vi.fn();
    gate.hold(1, resume);
    gate.sentEarly(2, settle);
    gate.dispose();
    gate.pong(true);
    expect(resume).toHaveBeenCalledExactlyOnceWith('disposed');
    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
    expect(onLive).not.toHaveBeenCalled();
  });

  it('sends the held reads of a cache miss at once and reads them again once live', async () => {
    const { gate, onLive } = await pingedGate();
    const missed = vi.fn();
    const waiting = vi.fn();
    gate.hold(1, missed);
    gate.hold(2, waiting);
    gate.missed(1);
    expect(missed).toHaveBeenCalledExactlyOnceWith('cache_miss');
    expect(waiting).not.toHaveBeenCalled();

    const settle = vi.fn();
    gate.sentEarly(1, settle);
    gate.pong(true);
    expect(settle).toHaveBeenCalledExactlyOnceWith(true);
    expect(waiting).toHaveBeenCalledExactlyOnceWith('live');
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set([1, 2]));
  });

  it('does not read an early read again when a held read of its query went out live', async () => {
    const { gate, onLive } = await pingedGate();
    const settle = vi.fn();
    gate.sentEarly(1, settle);
    gate.hold(1, vi.fn());
    gate.pong(true);
    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set([1]));
  });

  it('runs the bound only while a read waits', async () => {
    const { gate, onLive } = await pingedGate();
    gate.hold(1, vi.fn());
    gate.missed(1);
    const settle = vi.fn();
    gate.sentEarly(1, settle);
    await vi.advanceTimersByTimeAsync(LIVE_UPDATES_HOLD_MS);
    expect(gate.holding()).toBe(true);
    expect(settle).not.toHaveBeenCalled();

    gate.pong(true);
    expect(settle).toHaveBeenCalledExactlyOnceWith(true);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(false, new Set([1]));
  });

  it('leaves early reads to the stale live once the bound ends', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const settle = vi.fn();
    gate.sentEarly(1, settle);
    gate.hold(2, vi.fn());
    await vi.advanceTimersByTimeAsync(LIVE_UPDATES_HOLD_MS);
    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
    // A miss reported after the bound changes nothing.
    gate.missed(2);

    gate.connected(() => true);
    await vi.advanceTimersByTimeAsync(0);
    gate.pong(true);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(true, new Set());
  });

  it('leaves early reads to the stale live when the socket cannot be pinged', async () => {
    const onLive = vi.fn();
    const gate = createLiveUpdatesGate({ onLive });
    const settle = vi.fn();
    gate.sentEarly(1, settle);
    gate.connected(() => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
    expect(onLive).toHaveBeenCalledExactlyOnceWith(true, new Set([1]));
  });
});

function gatedClient(
  gate: LiveUpdatesGate,
  options: { cached?: boolean; network?: Exchange } = {}
) {
  const forwarded: Operation[] = [];
  const answer: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind !== 'teardown'),
      map((operation) => makeResult(operation, { data: {} }))
    );
  const record: Exchange =
    ({ forward }) =>
    (operations$) =>
      forward(
        pipe(
          operations$,
          onPush((operation) => forwarded.push(operation))
        )
      );
  const client = createClient({
    url: 'https://dss.test/graphql',
    exchanges: [
      liveUpdatesGateExchange(gate, { cached: options.cached }),
      record,
      options.network ?? answer,
    ],
  });
  const sent = () =>
    forwarded
      .filter(({ kind }) => kind !== 'teardown')
      .map(({ query }) => getOperationName(query));
  return { client, forwarded, sent };
}

function read(
  client: ReturnType<typeof createClient>,
  query: typeof FEED,
  context = {}
) {
  return pipe(
    client.executeQuery(createRequest(query, {}), context),
    subscribe(() => undefined)
  );
}

describe('liveUpdatesGateExchange', () => {
  it('holds reads that follow live updates until the gate opens', async () => {
    const { gate } = await pingedGate();
    const { client, sent } = gatedClient(gate);

    read(client, FEED, FOLLOWS_LIVE_UPDATES);
    read(client, OTHER);
    pipe(
      client.executeMutation(createRequest(RENAME, {}), FOLLOWS_LIVE_UPDATES),
      subscribe(() => undefined)
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Other', 'Rename']);

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Other', 'Rename', 'Feed']);
    expect(telemetry.spans).toMatchObject([
      {
        name: 'graphql_soup.live_updates.wait',
        attributes: {
          'graphql.operation.name': 'Feed',
          'live_updates.outcome': 'live',
        },
        ended: true,
      },
    ]);
  });

  it('passes reads through once the gate is open', async () => {
    const { gate } = await pingedGate();
    gate.pong(true);
    const { client, sent } = gatedClient(gate);
    read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed']);
    expect(telemetry.spans).toEqual([]);
  });

  it('drops a held read whose query is torn down', async () => {
    const { gate } = await pingedGate();
    const { client, forwarded } = gatedClient(gate);
    const subscription = read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);
    subscription.unsubscribe();

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(forwarded.map(({ kind }) => kind)).toEqual(['teardown']);
    expect(telemetry.spans).toMatchObject([
      { attributes: { 'live_updates.outcome': 'torn_down' }, ended: true },
    ]);
  });

  it('sends a held read in the trace its query started in', async () => {
    const { gate } = await pingedGate();
    const { client, forwarded } = gatedClient(gate);
    const parent = firstRequestIn({
      run: (work) => within('view.projects', work),
    });
    read(client, FEED, {
      ...FOLLOWS_LIVE_UPDATES,
      [TRACE_PARENT_CONTEXT_KEY]: parent,
    });
    await vi.advanceTimersByTimeAsync(0);
    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(telemetry.spans[0]?.parent).toBe('view.projects');
    const sent: Operation | undefined = forwarded[0];
    const sentParent = sent?.context[TRACE_PARENT_CONTEXT_KEY];
    expect(sentParent).not.toBe(parent);
    expect(sentParent.run(() => telemetry.active.at(-1))).toBe('view.projects');
    // Like the original, it joins that trace for its first request only.
    expect(sentParent.run(() => telemetry.active.at(-1))).toBeUndefined();
  });

  it('marks reads released by the bound', async () => {
    const gate = createLiveUpdatesGate({ onLive: vi.fn() });
    const { client, sent } = gatedClient(gate);
    read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(LIVE_UPDATES_HOLD_MS);
    expect(sent()).toEqual(['Feed']);
    expect(telemetry.spans).toMatchObject([
      { attributes: { 'live_updates.outcome': 'timed_out' } },
    ]);
  });

  // The client sends a query once until it has a result; the normalized cache
  // can deliver one for a held read, and a second reader's read or a refetch
  // then reaches the gate.
  it('sends every operation dispatched for a held query, in order', async () => {
    const { gate } = await pingedGate();
    const { source: operations$, next: dispatch } = makeSubject<Operation>();
    const forwarded: Operation[] = [];
    pipe(
      liveUpdatesGateExchange(gate)({
        client: {} as Client,
        dispatchDebug: () => undefined,
        forward: (forward$) =>
          pipe(
            forward$,
            onPush((operation) => forwarded.push(operation)),
            filter(() => false),
            map((operation) => makeResult(operation, { data: {} }))
          ),
      })(operations$),
      subscribe(() => undefined)
    );
    const { client } = gatedClient(gate);
    const request = createRequest(FEED, {});
    const parent = firstRequestIn({
      run: (work) => within('view.projects', work),
    });
    const first = client.createRequestOperation('query', request, {
      ...FOLLOWS_LIVE_UPDATES,
      [TRACE_PARENT_CONTEXT_KEY]: parent,
    });
    dispatch(first);
    // A re-execution carries the context its trace was already used from.
    dispatch(
      client.createRequestOperation('query', request, {
        ...first.context,
        requestPolicy: 'network-only',
      })
    );
    expect(forwarded).toEqual([]);

    gate.pong(true);
    expect(forwarded.map(({ context }) => context.requestPolicy)).toEqual([
      'cache-first',
      'network-only',
    ]);
    expect(forwarded[0]?.context[TRACE_PARENT_CONTEXT_KEY]).not.toBe(parent);
    expect(forwarded[1]?.context[TRACE_PARENT_CONTEXT_KEY]).toBe(parent);
    // Only the first had a trace to wait in.
    expect(telemetry.spans).toMatchObject([
      {
        parent: 'view.projects',
        attributes: { 'live_updates.outcome': 'live' },
      },
    ]);
  });

  it('shows a cached result at once while its read waits', async () => {
    const { gate } = await pingedGate();
    const host = {
      ...createNoopCacheHost(),
      disabled: false,
      readQuery: async () => ({
        kind: 'hit' as const,
        data: { feed: [{ id: 'cached' }] },
      }),
    };
    const reads: string[] = [];
    const network: Exchange = () => (operations$) =>
      pipe(
        operations$,
        filter((operation) => operation.kind === 'query'),
        onPush(() => reads.push('Feed')),
        map((operation) =>
          makeResult(operation, { data: { feed: [{ id: 'server' }] } })
        )
      );
    const client = createClient({
      url: 'https://dss.test/graphql',
      exchanges: [
        normalizedCacheExchange(host),
        liveUpdatesGateExchange(gate),
        network,
      ],
    });
    const results: OperationResult[] = [];
    pipe(
      client.executeQuery(createRequest(FEED, {}), {
        requestPolicy: 'cache-and-network',
        ...FOLLOWS_LIVE_UPDATES,
      }),
      subscribe((result) => results.push(result))
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual([]);
    expect(results.map(({ data, stale }) => ({ data, stale }))).toEqual([
      { data: { feed: [{ id: 'cached' }] }, stale: true },
    ]);

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(['Feed']);
    expect(results.at(-1)).toMatchObject({
      data: { feed: [{ id: 'server' }] },
      stale: false,
    });
  });

  it('leaves the normalized cache with no request in flight once held reads answer', async () => {
    const run = async (gated: boolean) => {
      const { gate } = await pingedGate();
      let affected: ((keys: number[]) => void) | undefined;
      const host = {
        ...createNoopCacheHost(),
        disabled: false,
        readQuery: async () => ({
          kind: 'hit' as const,
          data: { feed: [{ id: 'cached' }] },
        }),
        onOpsAffected: (listener: (keys: number[]) => void) => {
          affected = listener;
          return () => undefined;
        },
      };
      let reads = 0;
      const network: Exchange = () => (operations$) =>
        pipe(
          operations$,
          filter((operation) => operation.kind === 'query'),
          onPush(() => {
            reads += 1;
          }),
          map((operation) =>
            makeResult(operation, { data: { feed: [{ id: 'server' }] } })
          )
        );
      const client = createClient({
        url: 'https://dss.test/graphql',
        exchanges: [
          normalizedCacheExchange(host),
          ...(gated ? [liveUpdatesGateExchange(gate)] : []),
          network,
        ],
      });
      const observe = () => {
        const results: OperationResult[] = [];
        pipe(
          client.executeQuery(createRequest(FEED, {}), {
            requestPolicy: 'cache-and-network',
            ...FOLLOWS_LIVE_UPDATES,
          }),
          subscribe((result) => results.push(result))
        );
        return results;
      };
      // Two readers of one query; the second mounts after the cached result.
      const first = observe();
      await vi.advanceTimersByTimeAsync(0);
      const second = observe();
      await vi.advanceTimersByTimeAsync(0);
      gate.pong(true);
      await vi.advanceTimersByTimeAsync(0);
      // A later change to the query's records reads it from the cache again.
      affected?.([createRequest(FEED, {}).key]);
      await vi.advanceTimersByTimeAsync(0);
      return {
        reads,
        stale: [first.at(-1)?.stale, second.at(-1)?.stale],
      };
    };

    const ungated = await run(false);
    expect(ungated.stale).toEqual([false, false]);
    expect(await run(true)).toEqual(ungated);
  });

  it('sends a cache miss at once and again once live, and a hit once', async () => {
    const { gate } = await pingedGate();
    const host = {
      ...createNoopCacheHost(),
      disabled: false,
      readQuery: async ({ operationName }: { operationName?: string }) =>
        operationName === 'Other'
          ? { kind: 'hit' as const, data: { other: [{ id: 'cached' }] } }
          : { kind: 'miss' as const },
    };
    const reads: (string | undefined)[] = [];
    const network: Exchange = () => (operations$) =>
      pipe(
        operations$,
        filter((operation) => operation.kind === 'query'),
        onPush((operation) => reads.push(getOperationName(operation.query))),
        map((operation) =>
          makeResult(operation, {
            data:
              getOperationName(operation.query) === 'Feed'
                ? { feed: [{ id: 'server' }] }
                : { other: [{ id: 'server' }] },
          })
        )
      );
    const client = createClient({
      url: 'https://dss.test/graphql',
      exchanges: [
        normalizedCacheExchange(host, {
          onCacheMiss: (operation) => gate.missed(operation.key),
        }),
        liveUpdatesGateExchange(gate),
        network,
      ],
    });
    const observe = (query: typeof FEED) => {
      const results: OperationResult[] = [];
      pipe(
        client.executeQuery(createRequest(query, {}), {
          requestPolicy: 'cache-and-network',
          ...FOLLOWS_LIVE_UPDATES,
        }),
        subscribe((result) => results.push(result))
      );
      return results;
    };
    const feed = observe(FEED);
    const other = observe(OTHER);
    await vi.advanceTimersByTimeAsync(0);
    // The miss is answered from the server before the subscriptions are live;
    // the hit shows its cached result and waits.
    expect(reads).toEqual(['Feed']);
    expect(feed.at(-1)?.data).toEqual({ feed: [{ id: 'server' }] });
    expect(other.map(({ data }) => data)).toEqual([
      { other: [{ id: 'cached' }] },
    ]);

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(['Feed', 'Other', 'Feed']);
    expect(other.at(-1)?.data).toEqual({ other: [{ id: 'server' }] });
    expect(telemetry.spans).toMatchObject([
      {
        name: 'graphql_soup.live_updates.wait',
        attributes: {
          'graphql.operation.name': 'Feed',
          'live_updates.outcome': 'cache_miss',
        },
        ended: true,
      },
      {
        name: 'graphql_soup.live_updates.wait',
        attributes: {
          'graphql.operation.name': 'Other',
          'live_updates.outcome': 'live',
        },
        ended: true,
      },
      {
        name: 'graphql_soup.live_updates.reread',
        attributes: {
          'graphql.operation.name': 'Feed',
          'live_updates.answer_pending': false,
        },
        ended: true,
      },
    ]);
  });

  it('sends reads at once without a cache and reads them again once live', async () => {
    const { gate } = await pingedGate();
    const { client, forwarded, sent } = gatedClient(gate, { cached: false });
    read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed']);

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed', 'Feed']);
    const reread: Operation | undefined = forwarded.at(-1);
    expect(reread?.context.requestPolicy).toBe('network-only');
    // Its request runs in the reread's span.
    expect(
      reread?.context[TRACE_PARENT_CONTEXT_KEY].run(() =>
        telemetry.active.at(-1)
      )
    ).toBe('graphql_soup.live_updates.reread');
    expect(telemetry.spans).toMatchObject([
      { name: 'graphql_soup.live_updates.reread', ended: true },
    ]);

    // Once live, a read goes once.
    read(client, OTHER, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed', 'Feed', 'Other']);
  });

  it('reads an early read again only once it has answered', async () => {
    const { gate } = await pingedGate();
    const requests: Operation[] = [];
    const { source: answers$, next: answer } = makeSubject<OperationResult>();
    const network: Exchange = () => (operations$) =>
      merge([
        pipe(
          operations$,
          onPush((operation) => {
            if (operation.kind === 'query') requests.push(operation);
          }),
          filter(() => false),
          map((operation) => makeResult(operation, { data: {} }))
        ),
        answers$,
      ]);
    const { client, sent } = gatedClient(gate, { cached: false, network });
    read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    // A second request now could answer before the first and be overwritten.
    expect(sent()).toEqual(['Feed']);

    const [first] = requests.splice(0);
    if (first) answer(makeResult(first, { data: {} }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed', 'Feed']);
    expect(telemetry.spans).toMatchObject([
      {
        name: 'graphql_soup.live_updates.reread',
        attributes: { 'live_updates.answer_pending': true },
        ended: false,
      },
    ]);

    const [again] = requests.splice(0);
    if (again) answer(makeResult(again, { data: {} }));
    expect(telemetry.spans).toMatchObject([{ ended: true }]);
  });

  it('does not read a query again once it is torn down', async () => {
    const { gate } = await pingedGate();
    const { client, sent } = gatedClient(gate, { cached: false });
    const subscription = read(client, FEED, FOLLOWS_LIVE_UPDATES);
    await vi.advanceTimersByTimeAsync(0);
    subscription.unsubscribe();

    gate.pong(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual(['Feed']);
    expect(telemetry.spans).toEqual([]);
  });
});
