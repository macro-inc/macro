import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createCacheSessionExchange } from '@graphql-cache/exchange/session-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { createRetirableCacheHost } from '@graphql-cache/host/retirable-host';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import {
  type Client,
  createClient,
  fetchExchange,
  subscriptionExchange,
} from '@urql/core';
import * as Effect from 'effect/Effect';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelTouches } from '../channel-pages';
import { createChannelPrewarm, prewarmChannels } from '../channel-prewarm';
import { createChannelStream } from '../channel-stream';
import { channelSyncRuntime } from '../channel-sync';
import { CATCH_UP_RETRY_MS } from '../channel-sync-runtime';
import { channelEngine } from './channel-engine';
import { CHANNEL_ID, graphqlMessage } from './fixtures';

const network = vi.hoisted(() => ({ client: undefined as Client | undefined }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => network.client,
}));
vi.mock('../channel-flag', () => ({
  channelCacheHost: () => undefined,
  CHANNEL_CACHE_HEAD_START_MS: 1_000,
  channelCacheAnswered: () => true,
  markChannelCacheAnswered: () => {},
  markChannelCacheUnsupported: () => {},
}));

type Message = ReturnType<typeof graphqlMessage>;
type Delta = {
  seq: string;
  resetRequired: boolean;
  hasMore: boolean;
  removedIds: string[];
  messages: Message[];
  activities: [];
};
const delta = (seq: string, options: Partial<Delta> = {}): Delta => ({
  seq,
  resetRequired: false,
  hasMore: false,
  removedIds: [],
  messages: [],
  activities: [],
  ...options,
});

type Written = {
  user?: {
    channelChanges?: Delta;
    channelTimeline?: { entries: Message[] };
  };
  channelTimelineUpdates?: Delta;
};

/** An engine holding messages 6 to 8 as of change 5, behind a cache host. */
function device() {
  const base = createNoopCacheHost();
  const engine = channelEngine('5');
  engine.apply(
    { channelId: CHANNEL_ID, seq: '5' },
    [6, 7, 8].map((n) => graphqlMessage(n))
  );
  engine.commits.length = 0;
  const host: CacheHost = {
    ...base,
    ...engine.host,
    disabled: false,
    async writeQuery(args) {
      const data = args.data as Written;
      const written =
        data.user?.channelChanges?.messages ??
        data.user?.channelTimeline?.entries ??
        data.channelTimelineUpdates?.messages ??
        [];
      const channel =
        args.channelCommit && engine.apply(args.channelCommit, written);
      return { ...(await base.writeQuery(args)), channel };
    },
  };
  return { engine, host };
}

function setup({ retirable = false } = {}) {
  const local = device();
  const host = retirable ? createRetirableCacheHost(local.host) : local.host;
  const requests: {
    after: string | undefined;
    signal: AbortSignal;
    answer: (page: Delta) => void;
    latest: (seq: string, entries: Message[]) => void;
    fail: () => void;
  }[] = [];
  const lifetime = new AbortController();
  let push: ((page: Delta) => void) | undefined;
  let endStream: (() => void) | undefined;
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [
      createCacheSessionExchange(lifetime.signal),
      normalizedCacheExchange(host, { signal: lifetime.signal }),
      subscriptionExchange({
        forwardSubscription: () => ({
          subscribe(observer) {
            // The subscription alone ends, the socket staying up.
            endStream = () =>
              observer.error(new Error('subscription fell behind'));
            push = (page) =>
              observer.next({
                data: {
                  channelTimelineUpdates: {
                    channelId: CHANNEL_ID,
                    seq: page.seq,
                    truncated: false,
                    messages: page.messages,
                    activities: [],
                    removedIds: page.removedIds,
                  },
                },
              });
            return {
              unsubscribe: () => {
                push = undefined;
                endStream = undefined;
              },
            };
          },
        }),
      }),
      fetchExchange,
    ],
    fetch: (input, init) => {
      const variables = init?.body
        ? JSON.parse(init.body as string).variables
        : JSON.parse(
            new URL(String(input)).searchParams.get('variables') ?? '{}'
          );
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        const respond = (body: unknown, status = 200) =>
          resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' },
            })
          );
        requests.push({
          after: variables.input.after,
          signal,
          answer: (page) =>
            respond({ data: { user: { channelChanges: page } } }),
          latest: (seq, entries) =>
            respond({
              data: {
                user: {
                  channelTimeline: {
                    entries,
                    olderCursor: null,
                    newerCursor: null,
                    seq,
                  },
                },
              },
            }),
          fail: () =>
            respond({ errors: [{ message: 'service unavailable' }] }, 503),
        });
      });
    },
  });
  const runtime = channelSyncRuntime(host);
  const changed = vi.fn();
  const release = runtime.open(CHANNEL_ID);
  runtime.onChanged(CHANNEL_ID, changed);
  runtime.noteStoredSeq(CHANNEL_ID, '5', runtime.mark(CHANNEL_ID));
  const stream = createChannelStream(network.client, runtime);
  stream.connected();
  return {
    ...local,
    host,
    runtime,
    requests,
    changed,
    release,
    cursors: () => requests.map(({ after }) => after),
    disconnect: () => stream.disconnected(),
    reconnect() {
      stream.disconnected();
      stream.connected();
    },
    push(seq: string, options: Partial<Delta> = {}) {
      if (!push) throw new Error('channel stream did not subscribe');
      push(delta(seq, options));
    },
    endStream() {
      if (!endStream) throw new Error('channel stream did not subscribe');
      endStream();
    },
    stop() {
      stream.dispose();
      runtime.dispose();
      // A retired host tears down the runtimes on it, as sign-out does.
      if (retirable) host.dispose();
      lifetime.abort();
    },
  };
}

type Test = ReturnType<typeof setup>;

async function withChannel(
  run: (test: Test) => Promise<void>,
  options?: Parameters<typeof setup>[0]
) {
  vi.useFakeTimers();
  const test = setup(options);
  try {
    await run(test);
  } finally {
    test.stop();
  }
}

const settled = () => vi.advanceTimersByTimeAsync(20);
/** Past the debounce and jitter of a scheduled catch-up. */
const debounced = () => vi.advanceTimersByTimeAsync(600);
const quiet = () => vi.spyOn(Telemetry, 'error').mockImplementation(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  network.client = undefined;
});

const id = (n: number) => graphqlMessage(n).id;

it('stores each page and where it leaves the channel in one write', () =>
  withChannel(async ({ requests, engine, runtime, cursors }) => {
    await debounced();
    requests[0].answer(delta('6', { hasMore: true, removedIds: [id(6)] }));
    await settled();
    expect(cursors()).toEqual(['5', '6']);
    requests[1].answer(
      delta('8', { messages: [graphqlMessage(8, { content: 'edited' })] })
    );
    await settled();
    expect(engine.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        seq: '6',
        watermark: { kind: 'advance', from: '5' },
        removedIds: [id(6)],
      },
      {
        channelId: CHANNEL_ID,
        seq: '8',
        watermark: { kind: 'advance', from: '6' },
        removedIds: [],
      },
    ]);
    expect(engine.seq()).toBe('8');
    expect(engine.holds(id(6))).toBe(false);
    expect(engine.content(id(8))).toBe('edited');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(requests).toHaveLength(2);
  }));

it('a reconnect cancels the old HTTP page and replays from what the device holds', () =>
  withChannel(async ({ requests, engine, runtime, reconnect, cursors }) => {
    const errors = vi.spyOn(Telemetry, 'error');
    await debounced();
    requests[0].answer(delta('6', { hasMore: true, removedIds: [id(6)] }));
    await settled();

    reconnect();
    await debounced();
    expect(requests[1].signal.aborted).toBe(true);
    expect(cursors()).toEqual(['5', '6', '6']);
    requests[1].answer(delta('7', { removedIds: [id(8)] }));
    requests[2].answer(
      delta('8', {
        removedIds: [id(7)],
        messages: [graphqlMessage(8, { content: 'edited while offline' })],
      })
    );
    await settled();

    expect(engine.seq()).toBe('8');
    expect([6, 7, 8].map((n) => engine.content(id(n)))).toEqual([
      undefined,
      undefined,
      'edited while offline',
    ]);
    expect(errors).not.toHaveBeenCalled();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(requests).toHaveLength(3);
  }));

it('keeps an edit pushed while the older page that replays it is out', () =>
  withChannel(async ({ requests, engine, runtime, push, cursors }) => {
    await debounced();
    push('7', { messages: [graphqlMessage(6, { content: 'newer edit' })] });
    await settled();
    expect(engine.content(id(6))).toBe('newer edit');
    expect(engine.seq()).toBe('5');

    requests[0].answer(
      delta('6', { messages: [graphqlMessage(6, { content: 'older edit' })] })
    );
    await debounced();
    // The page stopped short of the frame, so what is left is read.
    expect(engine.content(id(6))).toBe('newer edit');
    expect(cursors()).toEqual(['5', '6']);
    requests[1].answer(
      delta('7', { messages: [graphqlMessage(6, { content: 'newer edit' })] })
    );
    await settled();
    expect(engine.seq()).toBe('7');
    expect(engine.content(id(6))).toBe('newer edit');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(requests).toHaveLength(2);
  }));

it('brings nothing back from a page read before a pushed delete', () =>
  withChannel(async ({ requests, engine, push }) => {
    await debounced();
    push('7', { removedIds: [id(6)] });
    await settled();
    expect(engine.holds(id(6))).toBe(false);
    requests[0].answer(
      delta('6', { messages: [graphqlMessage(6, { content: 'edit' })] })
    );
    await debounced();
    expect(engine.holds(id(6))).toBe(false);
    requests[1].answer(delta('7', { removedIds: [id(6)] }));
    await settled();
    expect(engine.holds(id(6))).toBe(false);
    expect(engine.seq()).toBe('7');
  }));

it('reads a frame too large to carry from the server', () =>
  withChannel(async ({ requests, engine, push, runtime, cursors }) => {
    await debounced();
    requests[0].answer(delta('5'));
    await settled();
    expect(engine.commits).toHaveLength(1);
    // As the stream sends it: no records, and no word of what it left out.
    const truncated = engine.apply({
      channelId: CHANNEL_ID,
      seq: '6',
      watermark: { kind: 'advance', from: '6' },
    });
    expect(truncated.outcome).toBe('gap');
    push('7');
    await debounced();
    expect(cursors()).toEqual(['5', '5']);
    requests[1].answer(
      delta('7', { messages: [graphqlMessage(6, { content: 'long' })] })
    );
    await settled();
    expect(engine.content(id(6))).toBe('long');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  }));

it('replaces the channel with its latest page in one write when the server says to', () =>
  withChannel(async ({ requests, engine, runtime, cursors, changed }) => {
    await debounced();
    requests[0].answer(delta('5', { resetRequired: true }));
    await settled();
    expect(cursors()).toEqual(['5', undefined]);
    expect(engine.commits).toEqual([]);
    requests[1].latest('900', [graphqlMessage(9)]);
    await settled();
    expect(engine.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        seq: '900',
        reset: true,
        coverage: [
          { start: CHANNEL_TIMELINE_START, end: CHANNEL_TIMELINE_HEAD },
        ],
      },
    ]);
    expect(engine.seq()).toBe('900');
    expect(engine.holds(id(6))).toBe(false);
    expect(engine.holds(id(9))).toBe(true);
    expect(changed).toHaveBeenCalledWith('reset');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  }));

it('a gap scheduled while a catch-up runs waits for it, without ending its request', () =>
  withChannel(async ({ requests, engine, push, runtime }) => {
    await debounced();
    expect(requests).toHaveLength(1);
    push('8');
    await debounced();
    expect(requests[0].signal.aborted).toBe(false);
    expect(requests).toHaveLength(1);
    requests[0].answer(delta('8', { removedIds: [id(6)] }));
    await debounced();
    // The gap it waited behind finds the channel current.
    expect(requests).toHaveLength(1);
    expect(engine.seq()).toBe('8');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  }));

it('a view closing leaves its shared catch-up able to store for the next open', () =>
  withChannel(async ({ requests, engine, runtime, release }) => {
    await debounced();
    release();
    requests[0].answer(delta('6', { removedIds: [id(6)] }));
    await settled();
    expect(engine.seq()).toBe('6');
    const releaseAgain = runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(requests).toHaveLength(1);
    releaseAgain();
  }));

it('keeps a post-reconnect edit when the channel closes during catch-up and reopens', () =>
  withChannel(
    async ({
      requests,
      engine,
      runtime,
      release,
      reconnect,
      push,
      cursors,
    }) => {
      await debounced();
      release();
      reconnect();
      push('7', { messages: [graphqlMessage(6, { content: 'latest edit' })] });
      await settled();
      requests[0].answer(
        delta('6', { messages: [graphqlMessage(6, { content: 'older edit' })] })
      );
      await debounced();
      expect(engine.content(id(6))).toBe('latest edit');

      const releaseAgain = runtime.open(CHANNEL_ID);
      const caughtUp = runtime.ensureCurrent(CHANNEL_ID);
      await settled();
      const reopened = requests.at(-1)!;
      expect(cursors()).toHaveLength(2);
      reopened.answer(
        delta('7', {
          messages: [graphqlMessage(6, { content: 'latest edit' })],
        })
      );
      await caughtUp;
      releaseAgain();
      expect(engine.seq()).toBe('7');
      expect(engine.content(id(6))).toBe('latest edit');
    }
  ));

it('disposing a scheduled catch-up cancels its HTTP query without an error', () =>
  withChannel(async ({ requests, engine, runtime }) => {
    const errors = vi.spyOn(Telemetry, 'error');
    await debounced();
    runtime.dispose();
    await settled();
    expect(requests[0].signal.aborted).toBe(true);
    expect(engine.commits).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  }));

it.each(['dispose', 'a retired host', 'a reconnect'])(
  '%s ends an open catch-up before it stores',
  (how) =>
    withChannel(
      async ({ requests, engine, runtime, stop, reconnect }) => {
        const outcome = runtime.ensureCurrent(CHANNEL_ID);
        await settled();
        expect(requests).toHaveLength(1);
        if (how === 'dispose') runtime.dispose();
        else if (how === 'a reconnect') reconnect();
        else stop();
        await settled();
        expect(requests[0].signal.aborted).toBe(true);
        await expect(outcome).resolves.toBe('skipped');
        expect(engine.commits).toEqual([]);
      },
      { retirable: true }
    )
);

it('applies an open catch-up HTTP answers while the socket is down', () =>
  withChannel(async ({ requests, engine, runtime, disconnect }) => {
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    disconnect();
    await settled();
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].answer(
      delta('6', { messages: [graphqlMessage(6, { content: 'edit' })] })
    );
    await expect(open).resolves.toBe('applied');
    expect(engine.content(id(6))).toBe('edit');
    expect(engine.seq()).toBe('6');
  }));

it.each(['frame', 'reconnect'])(
  'lets a %s bring a backed-off retry forward',
  (signal) =>
    withChannel(async ({ requests, push, reconnect, cursors }) => {
      quiet();
      await debounced();
      requests[0].fail();
      await settled();
      if (signal === 'frame') push('7');
      else reconnect();
      await debounced();
      expect(cursors()).toEqual(['5', '5']);
    })
);

it('closes a gap while frames keep arriving after a failed catch-up', () =>
  withChannel(async ({ requests, push, cursors }) => {
    quiet();
    await debounced();
    requests[0].answer(delta('5'));
    await settled();
    push('7');
    await debounced();
    requests[1].fail();
    await settled();
    // 6 is missing, and a later frame comes every 200 ms.
    for (let seq = 8; seq < 58; seq += 1) {
      push(String(seq));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(cursors()).toEqual(['5', '5', '5']);
  }));

it('keeps the retry wait when reads find the device behind during an outage', () =>
  withChannel(async ({ requests, engine, runtime, cursors }) => {
    quiet();
    await debounced();
    requests[0].fail();
    await vi.advanceTimersByTimeAsync(0);
    // Three server pages load and store normally; the replay endpoint is down.
    for (let load = 0; load < 3; load += 1) {
      const seen = requests.length;
      const mark = runtime.mark(CHANNEL_ID);
      const { seq } = engine.apply({
        channelId: CHANNEL_ID,
        seq: '7',
        watermark: { kind: 'lower' },
      });
      runtime.noteServerRead(CHANNEL_ID, { seq, readSeq: '7', mark });
      await debounced();
      for (const request of requests.slice(seen)) request.fail();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(engine.seq()).toBe('5');
    expect(cursors()).toEqual(['5']);
    await vi.advanceTimersByTimeAsync(CATCH_UP_RETRY_MS);
    expect(cursors()).toEqual(['5', '5']);
  }));

it('finishes warming an offscreen channel across a stream-only drop', () =>
  withChannel(
    async ({
      host,
      requests,
      engine,
      runtime,
      release,
      endStream,
      cursors,
    }) => {
      quiet();
      release();
      const warmed = Effect.runPromise(
        prewarmChannels({
          host,
          runtime,
          touches: createChannelTouches(),
          listChannels: async () => [CHANNEL_ID],
          idle: Effect.void,
          online: () => true,
        })
      );
      await settled();
      expect(cursors()).toEqual(['5']);
      endStream();
      await settled();
      expect(runtime.connected()).toBe(false);
      // The stream subscribes again, which ends the first ask: the channel is
      // not on screen, so prewarm asks once more.
      await vi.advanceTimersByTimeAsync(1_600);
      expect(runtime.connected()).toBe(true);
      expect(requests[0].signal.aborted).toBe(true);
      expect(cursors()).toEqual(['5', '5']);
      requests[1].answer(
        delta('6', { messages: [graphqlMessage(6, { content: 'edit' })] })
      );
      await expect(warmed).resolves.toMatchObject({ held: 1, failed: 0 });
      expect(engine.content(id(6))).toBe('edit');
    }
  ));

it('asks nothing more from a prewarm pass that was replaced', () =>
  withChannel(async ({ host, runtime, release, reconnect, cursors }) => {
    quiet();
    release();
    const ensureCurrent = vi.spyOn(runtime, 'ensureCurrent');
    const prewarm = createChannelPrewarm({
      host,
      runtime,
      touches: createChannelTouches(),
      listChannels: async () => [CHANNEL_ID],
      idle: Effect.void,
      online: () => true,
    });
    try {
      prewarm.run();
      await vi.advanceTimersByTimeAsync(40);
      expect(cursors()).toEqual(['5']);
      prewarm.run(5_000);
      await settled();
      reconnect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(cursors()).toEqual(['5']);
      expect(ensureCurrent).toHaveBeenCalledTimes(1);
    } finally {
      prewarm.dispose();
    }
  }));
