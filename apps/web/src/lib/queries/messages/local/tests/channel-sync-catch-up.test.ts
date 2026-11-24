import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createCacheSessionExchange } from '@graphql-cache/exchange/session-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
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

function setup() {
  const local = device();
  const requests: {
    after: string;
    signal: AbortSignal;
    answer: (page: Delta) => void;
  }[] = [];
  const lifetime = new AbortController();
  let push:
    | ((seq: string, message: ReturnType<typeof graphqlMessage>) => void)
    | undefined;
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [
      createCacheSessionExchange(lifetime.signal),
      normalizedCacheExchange(local.host, { signal: lifetime.signal }),
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
        });
      });
    },
  });
  const runtime = channelSyncRuntime(local.host);
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
    expect(test.changed).toHaveBeenCalledTimes(1);
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
