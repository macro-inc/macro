import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createCacheSessionExchange } from '@graphql-cache/exchange/session-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { createRetirableCacheHost } from '@graphql-cache/host/retirable-host';
import type { CacheHost } from '@graphql-cache/host/types';

type ChannelTimelineCommitArgs = Parameters<
  CacheHost['channelTimelineCommit']
>[0];

import { Telemetry } from '@macro-inc/observability';
import {
  type Client,
  createClient,
  fetchExchange,
  subscriptionExchange,
} from '@urql/core';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelStream } from '../channel-stream';
import { channelSyncRuntime } from '../channel-sync';
import { COMMIT_BUDGET_MS } from '../channel-sync-runtime';
import { CHANNEL_ID, devicePage, graphqlMessage } from './fixtures';

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

type Delta = {
  seq: string;
  resetRequired: boolean;
  hasMore: boolean;
  removedIds: string[];
  messages: ReturnType<typeof graphqlMessage>[];
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

function device() {
  const base = createNoopCacheHost();
  const records = new Map<string, string>(
    [6, 7, 8].map((n) => {
      const message = graphqlMessage(n);
      return [`GraphqlChannelMessage:${message.id}`, message.content] as const;
    })
  );
  const commits: ChannelTimelineCommitArgs[] = [];
  let seq: string | null = '5';
  const host = {
    ...base,
    disabled: false,
    async channelTimeline() {
      return devicePage([], { covered: seq !== null, seq });
    },
    async channelTimelineCommit(args: ChannelTimelineCommitArgs) {
      commits.push(args);
      if (args.reset) {
        records.clear();
        seq = null;
      }
      for (const key of args.removedKeys ?? []) records.delete(key);
      if (args.seq?.kind === 'advance' && args.seq.from === seq)
        seq = args.seq.to;
      return {
        kind: 'committed' as const,
        revision: await base.currentRevision(),
        changed: [],
        channelSeq: seq,
      };
    },
    async writeQuery(args: Parameters<typeof base.writeQuery>[0]) {
      const data = args.data as {
        user?: { channelChanges?: Delta };
        channelTimelineUpdates?: Delta;
      };
      const page = data.user?.channelChanges ?? data.channelTimelineUpdates;
      for (const message of page?.messages ?? []) {
        records.set(`GraphqlChannelMessage:${message.id}`, message.content);
      }
      return base.writeQuery(args);
    },
  };
  return { host, records, commits, seq: () => seq };
}

function setup({ retirable = false } = {}) {
  const local = device();
  const host = retirable ? createRetirableCacheHost(local.host) : local.host;
  const requests: {
    after: string;
    signal: AbortSignal;
    answer: (page: Delta) => void;
    fail: () => void;
  }[] = [];
  const lifetime = new AbortController();
  let push:
    | ((seq: string, message: ReturnType<typeof graphqlMessage>) => void)
    | undefined;
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [
      createCacheSessionExchange(lifetime.signal),
      normalizedCacheExchange(host, { signal: lifetime.signal }),
      subscriptionExchange({
        forwardSubscription: () => ({
          subscribe(observer) {
            push = (seq, message) =>
              observer.next({
                data: {
                  channelTimelineUpdates: {
                    channelId: CHANNEL_ID,
                    seq,
                    messages: [message],
                    activities: [],
                    removedIds: [],
                  },
                },
              });
            return {
              unsubscribe: () => {
                push = undefined;
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
        : JSON.parse(new URL(String(input)).searchParams.get('variables')!);
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        requests.push({
          after: variables.input.after,
          signal,
          answer: (page) =>
            resolve(
              new Response(
                JSON.stringify({ data: { user: { channelChanges: page } } }),
                {
                  headers: { 'content-type': 'application/json' },
                }
              )
            ),
          fail: () =>
            resolve(
              new Response(
                JSON.stringify({
                  errors: [{ message: 'temporary service unavailable' }],
                }),
                {
                  status: 503,
                  headers: { 'content-type': 'application/json' },
                }
              )
            ),
        });
      });
    },
  });
  const runtime = channelSyncRuntime(host);
  const changed = vi.fn();
  const release = runtime.open(CHANNEL_ID);
  runtime.onChanged(CHANNEL_ID, changed);
  runtime.noteStoredSeq(CHANNEL_ID, '5');
  const stream = createChannelStream(network.client, runtime);
  stream.connected();
  return {
    ...local,
    runtime,
    requests,
    changed,
    release,
    disconnect() {
      stream.disconnected();
    },
    reconnect() {
      stream.disconnected();
      stream.connected();
    },
    push(seq: string, message: ReturnType<typeof graphqlMessage>) {
      if (!push) throw new Error('channel stream did not subscribe');
      push(seq, message);
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  network.client = undefined;
});

it('reconnect cancels the old HTTP page and replays from the committed page', async () => {
  vi.useFakeTimers();
  const errors = vi.spyOn(Telemetry, 'error');
  const test = setup();
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests.map(({ after }) => after)).toEqual(['5']);
    test.requests[0].answer(
      delta('6', { hasMore: true, removedIds: [graphqlMessage(6).id] })
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(test.seq()).toBe('6');
    expect(test.requests.map(({ after }) => after)).toEqual(['5', '6']);

    test.reconnect();
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests[1].signal.aborted).toBe(true);
    expect(test.requests.map(({ after }) => after)).toEqual(['5', '6', '6']);
    test.requests[1].answer(delta('7', { removedIds: [graphqlMessage(8).id] }));
    test.requests[2].answer(
      delta('8', {
        removedIds: [graphqlMessage(7).id],
        messages: [graphqlMessage(8, { content: 'edited while offline' })],
      })
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(test.seq()).toBe('8');
    expect([...test.records.values()]).toEqual(['edited while offline']);
    expect(test.commits.some(({ reset }) => reset)).toBe(false);
    // Once for the page the replaced catch-up committed, once for the replay.
    expect(test.changed).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.requests).toHaveLength(3);
  } finally {
    test.stop();
  }
});

it('a newly scheduled gap catch-up replaces an active request without a reconnect', async () => {
  vi.useFakeTimers();
  const errors = vi.spyOn(Telemetry, 'error');
  const test = setup();
  try {
    // A frame tells the runtime that a subsequently finishing server read is stale.
    test.runtime.onFrame(
      { channelId: CHANNEL_ID, seq: '8', removedIds: [] },
      false
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(1);

    test.runtime.noteServerRead(CHANNEL_ID, '5', test.runtime.epoch(), '5');
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests[0].signal.aborted).toBe(true);
    expect(test.requests.map(({ after }) => after)).toEqual(['5', '5']);
    test.requests[1].answer(delta('8', { removedIds: [graphqlMessage(6).id] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(test.seq()).toBe('8');
    expect(
      test.records.has(`GraphqlChannelMessage:${graphqlMessage(6).id}`)
    ).toBe(false);
    expect(test.commits.some(({ reset }) => reset)).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    test.stop();
  }
});

it('a view closing leaves its shared catch-up able to commit for the next open', async () => {
  vi.useFakeTimers();
  const test = setup();
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(1);
    test.release();
    test.requests[0].answer(delta('6', { removedIds: [graphqlMessage(6).id] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(test.seq()).toBe('6');
    expect(
      test.records.has(`GraphqlChannelMessage:${graphqlMessage(6).id}`)
    ).toBe(false);

    const releaseAgain = test.runtime.open(CHANNEL_ID);
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.requests).toHaveLength(1);
    expect(test.commits.some(({ reset }) => reset)).toBe(false);
    releaseAgain();
  } finally {
    test.stop();
  }
});

it('keeps an edit received after reconnect when the old HTTP snapshot arrives last', async () => {
  vi.useFakeTimers();
  const test = setup();
  const previousEdit = graphqlMessage(6, { content: 'edit before reconnect' });
  const latestEdit = graphqlMessage(6, { content: 'edit after reconnect' });
  const key = `GraphqlChannelMessage:${latestEdit.id}`;
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests.map(({ after }) => after)).toEqual(['5']);
    test.reconnect();

    test.push('7', latestEdit);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.records.get(key)).toBe(latestEdit.content);
    test.requests[0].answer(delta('6', { messages: [previousEdit] }));
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(2);
    const replacement = test.requests[1];
    replacement.answer(
      delta('7', {
        messages: replacement.after === '7' ? [] : [latestEdit],
      })
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(test.seq()).toBe('7');
    expect(test.commits.some(({ reset }) => reset)).toBe(false);
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.requests).toHaveLength(2);
    expect(test.records.get(key)).toBe(latestEdit.content);
  } finally {
    test.stop();
  }
});

it('keeps a post-reconnect edit when a channel closes during catch-up and reopens', async () => {
  vi.useFakeTimers();
  const test = setup();
  const previousEdit = graphqlMessage(6, { content: 'edit before reconnect' });
  const latestEdit = graphqlMessage(6, { content: 'edit after reconnect' });
  const key = `GraphqlChannelMessage:${latestEdit.id}`;
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(1);
    test.release();
    test.reconnect();

    test.push('7', latestEdit);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.records.get(key)).toBe(latestEdit.content);
    test.requests[0].answer(delta('6', { messages: [previousEdit] }));
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(1);

    const releaseAgain = test.runtime.open(CHANNEL_ID);
    const caughtUp = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests).toHaveLength(2);
    const reopened = test.requests[1];
    reopened.answer(
      delta('7', {
        messages: reopened.after === '7' ? [] : [latestEdit],
      })
    );
    await vi.advanceTimersByTimeAsync(20);
    await caughtUp;
    releaseAgain();

    expect(test.seq()).toBe('7');
    expect(test.records.get(key)).toBe(latestEdit.content);
  } finally {
    test.stop();
  }
});

it('disposing a scheduled catch-up cancels the real HTTP query without a sync error', async () => {
  vi.useFakeTimers();
  const errors = vi.spyOn(Telemetry, 'error');
  const test = setup();
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests).toHaveLength(1);
    test.runtime.dispose();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests[0].signal.aborted).toBe(true);
    expect(test.seq()).toBe('5');
    expect(test.commits).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    test.stop();
  }
});
it('publishes the committed removal if the socket drops before the commit settles', async () => {
  vi.useFakeTimers();
  const test = setup();
  const id = graphqlMessage(6).id;
  const key = `GraphqlChannelMessage:${id}`;
  const commit = test.host.channelTimelineCommit;
  const ready = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  try {
    vi.spyOn(test.host, 'channelTimelineCommit').mockImplementationOnce(
      async (args) => {
        ready.resolve();
        await finish.promise;
        return commit(args);
      }
    );

    await vi.advanceTimersByTimeAsync(600);
    test.requests[0].answer(delta('6', { removedIds: [id] }));
    await vi.advanceTimersByTimeAsync(20);
    await ready.promise;
    test.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    finish.resolve();
    await vi.advanceTimersByTimeAsync(20);

    expect(test.seq()).toBe('6');
    expect(test.records.has(key)).toBe(false);
    expect(test.changed).toHaveBeenCalledTimes(1);
  } finally {
    finish.resolve();
    test.stop();
  }
});

it('reconnect starts from the durable sequence while its earlier commit acknowledgement is delayed', async () => {
  vi.useFakeTimers();
  const test = setup();
  const commit = test.host.channelTimelineCommit;
  const ack = Promise.withResolvers<void>();
  try {
    vi.spyOn(test.host, 'channelTimelineCommit').mockImplementationOnce(
      async (args) => {
        const result = await commit(args);
        await ack.promise;
        return result;
      }
    );
    await vi.advanceTimersByTimeAsync(600);
    test.requests[0].answer(delta('6', { removedIds: [graphqlMessage(6).id] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(test.seq()).toBe('6');

    test.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    ack.resolve();
    await vi.advanceTimersByTimeAsync(20);
    test.reconnect();
    await vi.advanceTimersByTimeAsync(600);

    expect(test.requests).toHaveLength(2);
    const replay = test.requests[1];
    // The server is now 1000 changes ahead of the durable cursor, but 1001 ahead of the in-memory cursor.
    replay.answer(
      replay.after === '5'
        ? delta('1006', { resetRequired: true })
        : delta('206', { hasMore: true })
    );
    await vi.advanceTimersByTimeAsync(40);
    expect(test.commits.some(({ reset }) => reset)).toBe(false);
  } finally {
    ack.resolve();
    test.stop();
  }
});

it('an ensureCurrent waiter cannot use the permit while an interrupted held-frame commit is outstanding', async () => {
  vi.useFakeTimers();
  const test = setup();
  const commit = test.host.channelTimelineCommit;
  const ready = Promise.withResolvers<void>();
  const ack = Promise.withResolvers<void>();
  try {
    vi.spyOn(test.host, 'channelTimelineCommit').mockImplementation(
      async (args) => {
        if (
          args.seq?.kind === 'advance' &&
          args.seq.from === '7' &&
          args.seq.to === '8'
        ) {
          const result = await commit(args);
          ready.resolve();
          await ack.promise;
          return result;
        }
        return commit(args);
      }
    );

    await vi.advanceTimersByTimeAsync(20);
    test.push('8', graphqlMessage(8));
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests.map(({ after }) => after)).toEqual(['5']);
    test.requests[0].answer(delta('7', { messages: [graphqlMessage(7)] }));
    await vi.advanceTimersByTimeAsync(20);
    await ready.promise;
    expect(test.seq()).toBe('8');

    const waiter = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests).toHaveLength(1);
    test.reconnect();
    await vi.advanceTimersByTimeAsync(40);
    const concurrentCursors = test.requests.slice(1).map(({ after }) => after);

    ack.resolve();
    await vi.advanceTimersByTimeAsync(600);
    for (let index = 1; index < test.requests.length; index += 1) {
      const request = test.requests[index];
      request.answer(
        delta('8', {
          messages: request.after === '8' ? [] : [graphqlMessage(8)],
        })
      );
      await vi.advanceTimersByTimeAsync(20);
    }
    await waiter;
    expect(test.seq()).toBe('8');
    expect(concurrentCursors).toEqual([]);
  } finally {
    ack.resolve();
    test.stop();
  }
});

it('reads a page again when a newer frame stored an edit while the page was out', async () => {
  vi.useFakeTimers();
  const test = setup();
  const older = graphqlMessage(6, { content: 'older edit' });
  const newer = graphqlMessage(6, { content: 'newer edit' });
  const key = `GraphqlChannelMessage:${newer.id}`;
  try {
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests.map(({ after }) => after)).toEqual(['5']);
    test.push('7', newer);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.records.get(key)).toBe(newer.content);

    // Read before the edit, the page lands after it and writes the older one.
    test.requests[0].answer(delta('6', { messages: [older] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests.map(({ after }) => after)).toEqual(['5', '6']);
    test.requests[1].answer(delta('7', { messages: [newer] }));
    await vi.advanceTimersByTimeAsync(20);

    expect(test.records.get(key)).toBe(newer.content);
    expect(test.seq()).toBe('7');
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.requests).toHaveLength(2);
  } finally {
    test.stop();
  }
});

it('leaves a repair when every reread lands under a newer frame', async () => {
  vi.useFakeTimers();
  const test = setup();
  try {
    await vi.advanceTimersByTimeAsync(600);
    for (let round = 0; round < 3; round += 1) {
      const seq = 7 + round;
      test.push(String(seq), graphqlMessage(6, { content: `edit ${seq}` }));
      await vi.advanceTimersByTimeAsync(20);
      test.requests[round].answer(delta(String(seq - 1)));
      await vi.advanceTimersByTimeAsync(20);
    }
    // Three pages out, each overtaken; the catch-up stops and schedules one
    // that replays from the last page.
    expect(test.requests.map(({ after }) => after)).toEqual(['5', '6', '7']);
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests.map(({ after }) => after)).toEqual([
      '5',
      '6',
      '7',
      '8',
    ]);
  } finally {
    test.stop();
  }
});

const cursors = (test: ReturnType<typeof setup>) =>
  test.requests.map(({ after }) => after);
const recordKey = (n: number) =>
  `GraphqlChannelMessage:${graphqlMessage(n).id}`;

/** Stores the first commit but holds its answer until `ack` resolves. */
function delayCommit(test: ReturnType<typeof setup>) {
  const commit = test.host.channelTimelineCommit;
  const ack = Promise.withResolvers<void>();
  const state = { waiting: false };
  const spy = vi
    .spyOn(test.host, 'channelTimelineCommit')
    .mockImplementation(async (args: ChannelTimelineCommitArgs) => {
      const written = await commit(args);
      if (!state.waiting) {
        state.waiting = true;
        await ack.promise;
      }
      return written;
    });
  return { ack, state, spy };
}

it('replays an overwritten edit when a reconnect ends its reread', async () => {
  vi.useFakeTimers();
  const test = setup();
  const older = graphqlMessage(6, { content: 'older edit' });
  const newer = graphqlMessage(6, { content: 'newer edit' });
  try {
    await vi.advanceTimersByTimeAsync(600);
    test.push('7', newer);
    await vi.advanceTimersByTimeAsync(20);
    test.requests[0].answer(delta('6', { messages: [older] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(cursors(test)).toEqual(['5', '6']);
    expect(test.records.get(recordKey(6))).toBe('older edit');

    test.reconnect();
    await vi.advanceTimersByTimeAsync(600);
    expect(test.requests[1].signal.aborted).toBe(true);
    // The reconnect repairs from the overtaken page, which reads the edit.
    const replay = test.requests[2];
    expect(replay.after).toBe('6');
    replay.answer(delta('7', { messages: [newer] }));
    await vi.advanceTimersByTimeAsync(600);
    expect(test.seq()).toBe('7');
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.records.get(recordKey(6))).toBe('newer edit');
  } finally {
    test.stop();
  }
});

it('replays an overwritten edit when a drop lands during the page commit', async () => {
  vi.useFakeTimers();
  const test = setup();
  const older = graphqlMessage(6, { content: 'older edit' });
  const newer = graphqlMessage(6, { content: 'newer edit' });
  const delayed = delayCommit(test);
  try {
    await vi.advanceTimersByTimeAsync(600);
    test.push('7', newer);
    await vi.advanceTimersByTimeAsync(20);
    test.requests[0].answer(delta('6', { messages: [older] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(delayed.state.waiting).toBe(true);

    test.reconnect();
    await vi.advanceTimersByTimeAsync(20);
    delayed.ack.resolve();
    await vi.advanceTimersByTimeAsync(600);
    for (const replay of test.requests.slice(1)) {
      replay.answer(
        delta('7', { messages: replay.after === '7' ? [] : [newer] })
      );
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(test.seq()).toBe('7');
    await expect(test.runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe(
      'current'
    );
    expect(test.records.get(recordKey(6))).toBe('newer edit');
  } finally {
    delayed.ack.resolve();
    test.stop();
  }
});

it('leaves a failed repair to the next open instead of retrying at once', async () => {
  vi.useFakeTimers();
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const test = setup();
  try {
    await vi.advanceTimersByTimeAsync(600);
    test.requests[0].answer(delta('6', { messages: [graphqlMessage(6)] }));
    await vi.advanceTimersByTimeAsync(20);
    // A frame at or below the sequence held asks for a repair.
    test.push('6', graphqlMessage(6));
    await vi.advanceTimersByTimeAsync(600);
    expect(cursors(test)).toEqual(['5', '5']);
    test.requests[1].fail();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.requests).toHaveLength(2);

    const open = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    expect(cursors(test)).toEqual(['5', '5', '5']);
    test.requests[2].answer(delta('6', { messages: [graphqlMessage(6)] }));
    await expect(open).resolves.toBe('applied');
  } finally {
    test.stop();
  }
});

it('reads the device again once a page commit goes unanswered', async () => {
  vi.useFakeTimers();
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const test = setup();
  const delayed = delayCommit(test);
  try {
    await vi.advanceTimersByTimeAsync(600);
    test.requests[0].answer(delta('6', { messages: [graphqlMessage(6)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(delayed.state.waiting).toBe(true);

    test.reconnect();
    test.push('7', graphqlMessage(7));
    const open = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(COMMIT_BUDGET_MS + 1_000);
    // Past the budget the channel is free again and catches up from what the
    // device holds.
    expect(test.requests.length).toBeGreaterThan(1);
    const changedBefore = test.changed.mock.calls.length;
    delayed.ack.resolve();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.changed.mock.calls.length).toBeGreaterThan(changedBefore);
    for (const request of test.requests.slice(1)) {
      if (request.signal.aborted) continue;
      request.answer(delta('7', { messages: [graphqlMessage(7)] }));
      await vi.advanceTimersByTimeAsync(50);
    }
    await open;
    expect(test.seq()).toBe('7');
  } finally {
    delayed.ack.resolve();
    test.stop();
  }
});

it('starts no held-frame commit once disposed during a page commit', async () => {
  vi.useFakeTimers();
  const test = setup();
  const delayed = delayCommit(test);
  try {
    await vi.advanceTimersByTimeAsync(20);
    test.push('7', graphqlMessage(7));
    await vi.advanceTimersByTimeAsync(600);
    test.requests[0].answer(delta('6', { messages: [graphqlMessage(6)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(delayed.state.waiting).toBe(true);
    test.runtime.dispose();
    delayed.ack.resolve();
    await vi.advanceTimersByTimeAsync(600);
    expect(delayed.spy.mock.calls.map(([args]) => args.seq)).toEqual([
      { kind: 'advance', from: '5', to: '6' },
    ]);
  } finally {
    delayed.ack.resolve();
    test.stop();
  }
});

it('dispose ends an open catch-up request before it commits', async () => {
  vi.useFakeTimers();
  const test = setup();
  try {
    const outcome = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests).toHaveLength(1);
    test.runtime.dispose();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests[0].signal.aborted).toBe(true);
    await expect(outcome).resolves.toBe('skipped');
    expect(test.commits).toHaveLength(0);
  } finally {
    test.stop();
  }
});

it('a reconnect ends an open catch-up stuck on a reread', async () => {
  vi.useFakeTimers();
  const test = setup();
  try {
    const open = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    test.push('7', graphqlMessage(6, { content: 'newer edit' }));
    await vi.advanceTimersByTimeAsync(20);
    test.requests[0].answer(
      delta('6', { messages: [graphqlMessage(6, { content: 'older edit' })] })
    );
    await vi.advanceTimersByTimeAsync(20);
    const reread = test.requests[1];
    expect(reread.after).toBe('6');

    test.reconnect();
    test.push('8', graphqlMessage(8));
    await vi.advanceTimersByTimeAsync(600);
    expect(reread.signal.aborted).toBe(true);
    await expect(open).resolves.toBe('skipped');
    expect(test.requests.length).toBeGreaterThan(2);
  } finally {
    test.stop();
  }
});

it('retiring the host ends an open catch-up request', async () => {
  vi.useFakeTimers();
  const test = setup({ retirable: true });
  try {
    const outcome = test.runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests).toHaveLength(1);
    test.stop();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.requests[0].signal.aborted).toBe(true);
    await expect(outcome).resolves.toBe('skipped');
    expect(test.commits).toHaveLength(0);
  } finally {
    test.stop();
  }
});
