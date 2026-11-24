import { thrownResultErrorHasCode } from '@core/util/result';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import type { CacheRevision } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createRoot } from 'solid-js';
import { beforeAll, expect, it, vi } from 'vitest';
import {
  createChannelTouches,
  type FetchChannelServerPage,
  loadChannelPage,
} from '../channel-pages';
import { loadPrewarmChannelIds } from '../channel-prewarm';
import { createChannelSyncRuntime } from '../channel-sync-runtime';
import {
  type FetchChannelThreadPage,
  loadChannelThread,
} from '../channel-thread';
import {
  type ChannelTimelineRuntime,
  createLocalChannelTimeline,
} from '../channel-timeline';
import { createChannelWrites } from '../channel-writes';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
  keyOf,
} from './fixtures';
import {
  fakeClient,
  NOW,
  send,
  setup,
  writeHost,
  written,
} from './write-fixtures';

context.setGlobalContextManager(new StackContextManager().enable());
const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
);
beforeAll(() =>
  Telemetry.init({
    serviceName: 'test',
    environment: 'test',
    enabled: async () => true,
  })
);

it('keeps a cold page, its request and its store in one trace', async () => {
  // The device answers after an await: the request starts in a new task.
  const host = fakeHost([devicePage([], { covered: false })]);
  let requestSpan: string | undefined;
  const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
    requestSpan = trace.getActiveSpan()?.spanContext().spanId;
    return {
      page: {
        entries: [graphqlMessage(1)],
        olderCursor: null,
        newerCursor: null,
        seq: '9',
      },
      cached: Promise.resolve(),
    };
  });

  const loaded = await loadChannelPage(
    { host, touches: { due: () => undefined, settled: () => {} }, fetchPage },
    { channelId: CHANNEL_ID, limit: 50 }
  );
  if (loaded === 'unsupported') throw new Error('unexpected');
  expect(await loaded.stored).toEqual({ kind: 'stored', seq: '9' });

  const spans = exporter.getFinishedSpans();
  const page = spans.find((span) => span.name === 'channel.timeline_page');
  const store = spans.find((span) => span.name === 'channel.page.store');
  expect(requestSpan).toBe(page?.spanContext().spanId);
  expect(store?.parentSpanContext?.spanId).toBe(page?.spanContext().spanId);
  expect(store?.attributes['page.stored']).toBe('held');
});

it('keeps every page of a thread fill in the thread load trace', async () => {
  const root = graphqlMessage(1, {
    thread: {
      resolved: false,
      deletedAt: null,
      createdAt: '2026-11-01T10:00:01.000123Z',
      updatedAt: '2026-11-01T10:00:03.000123Z',
      userId: 'macro|sender@example.test',
      replyCount: 2,
      latestReplyAt: '2026-11-01T10:00:03.000123Z',
      preview: [],
    },
  });
  const host = fakeHost([devicePage([], { covered: false })]);
  const requestSpans: (string | undefined)[] = [];
  const fetchPage = vi.fn<FetchChannelThreadPage>(async (input) => {
    requestSpans.push(trace.getActiveSpan()?.spanContext().spanId);
    // Each page answers after an await, as the network does.
    await Promise.resolve();
    const reply = graphqlMessage(input.before ? 2 : 3, { threadId: root.id });
    return {
      page: {
        root,
        replies: [reply],
        olderCursor: input.before ? null : 'older',
        newerCursor: null,
        seq: '9',
      },
      cached: Promise.resolve(),
    };
  });

  const loaded = await loadChannelThread(host, CHANNEL_ID, root.id, {
    fetchPage,
  });
  if (loaded === 'unsupported') throw new Error('unexpected');

  const load = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'channel.thread_load');
  expect(requestSpans).toEqual([
    load?.spanContext().spanId,
    load?.spanContext().spanId,
  ]);
});

it('keeps a reply send in the trace of the composer that sent it', async () => {
  const root = graphqlMessage(1);
  const reply = graphqlMessage(8, { threadId: root.id });
  const { writes } = setup(
    () => ({
      data: written('sendChannelMessage', reply, root),
      disposition: { kind: 'committed' },
    }),
    [root]
  );

  await Telemetry.span('channel.composer.send', async () => {
    // The root is read from the device before the write span starts.
    await writes.send(send(reply.id, { content: 'reply', thread_id: root.id }));
  });

  const spans = exporter.getFinishedSpans();
  const parent = spans.find((span) => span.name === 'channel.composer.send');
  const write = spans.find((span) => span.name === 'channel.write.send');
  expect(write?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
});

it('runs a catch-up and its requests in a span under the open that asked for it', async () => {
  const host = {
    channelTimeline: async () => devicePage([], { covered: true, seq: '9' }),
    channelTimelineCommit: async () => ({
      kind: 'committed' as const,
      revision: '1' as CacheRevision,
      changed: [],
      channelSeq: '9',
    }),
  };
  let requestSpan: string | undefined;
  const runtime = createChannelSyncRuntime({
    host,
    fetchChanges: async () => {
      requestSpan = trace.getActiveSpan()?.spanContext().spanId;
      return {
        resetRequired: false,
        seq: '9',
        hasMore: false,
        removedIds: [],
        messages: [],
        activities: [],
      };
    },
    generation: () => 'generation-1',
    random: () => 0,
  });
  runtime.onConnected();
  try {
    await Telemetry.span('view.channel', async () => {
      await runtime.ensureCurrent(CHANNEL_ID);
    });
  } finally {
    runtime.dispose();
  }

  const spans = exporter.getFinishedSpans();
  const view = spans.find((span) => span.name === 'view.channel');
  const catchUp = spans.find((span) => span.name === 'channel.catch_up');
  expect(catchUp?.parentSpanContext?.spanId).toBe(view?.spanContext().spanId);
  expect(requestSpan).toBe(catchUp?.spanContext().spanId);
  expect(catchUp?.attributes).toMatchObject({
    'channel.id': CHANNEL_ID,
    'catch_up.reason': 'open',
    'catch_up.pages': 1,
  });
});

it('times each catch-up commit in a child span the device call runs in', async () => {
  let commitSpan: string | undefined;
  const host = {
    channelTimeline: async () => devicePage([], { covered: true, seq: '5' }),
    channelTimelineCommit: async () => {
      commitSpan = trace.getActiveSpan()?.spanContext().spanId;
      return {
        kind: 'committed' as const,
        revision: '1' as CacheRevision,
        changed: [],
        channelSeq: '9',
      };
    },
  };
  const runtime = createChannelSyncRuntime({
    host,
    fetchChanges: async () => ({
      resetRequired: false,
      seq: '9',
      hasMore: false,
      removedIds: [],
      messages: [],
      activities: [],
    }),
    generation: () => 'generation-1',
    random: () => 0,
  });
  runtime.onConnected();
  try {
    await runtime.ensureCurrent(CHANNEL_ID);
  } finally {
    runtime.dispose();
  }

  const spans = exporter.getFinishedSpans();
  const catchUp = spans.findLast((span) => span.name === 'channel.catch_up');
  const commit = spans.findLast(
    (span) => span.name === 'channel.catch_up.commit'
  );
  expect(commit?.parentSpanContext?.spanId).toBe(catchUp?.spanContext().spanId);
  expect(commitSpan).toBe(commit?.spanContext().spanId);
  expect(commit?.attributes).toMatchObject({
    'commit.kind': 'page',
    'catch_up.page': 0,
  });
});

it('lists the channels to prewarm in the pass span', async () => {
  const requestSpans: (string | undefined)[] = [];
  const fetchIds = vi.fn(async () => {
    requestSpans.push(trace.getActiveSpan()?.spanContext().spanId);
    return ['a'];
  });
  await Telemetry.span('channel.prewarm', (span) =>
    loadPrewarmChannelIds(span, fetchIds)
  );
  const pass = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'channel.prewarm');
  expect(requestSpans).toEqual([
    pass?.spanContext().spanId,
    pass?.spanContext().spanId,
  ]);
});

async function readPageAgain(
  scroll: (load: () => Promise<void>) => Promise<void>
) {
  const newest = graphqlMessage(2);
  // The window is held; the page before it is not.
  const host = fakeHost(
    (args) =>
      args.before === undefined
        ? devicePage([keyOf(newest)], { olderCursor: newest.sortKey })
        : devicePage([], { covered: false }),
    { records: [newest] }
  );
  const requestTraces: (string | undefined)[] = [];
  let reads = 0;
  const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
    requestTraces.push(trace.getActiveSpan()?.spanContext().traceId);
    reads += 1;
    const first = reads === 1;
    return {
      page: {
        entries: [graphqlMessage(1)],
        olderCursor: null,
        newerCursor: null,
        seq: '9',
      },
      cached: (async () => {
        if (first) throw new StaleCacheAuthorityError();
      })(),
    };
  });
  const runtime: ChannelTimelineRuntime = {
    open: vi.fn(() => () => {}),
    onChanged: vi.fn(() => () => {}),
    noteStoredSeq: vi.fn(),
    noteServerRead: vi.fn(),
    ensureCurrent: vi.fn(async () => 'current' as const),
    epoch: () => 3,
  };
  let dispose = () => {};
  const timeline = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createLocalChannelTimeline(
      { host, runtime, touches: createChannelTouches(), fetchPage },
      CHANNEL_ID,
      () => undefined,
      vi.fn()
    );
  });
  try {
    await vi.waitFor(() => expect(timeline.hasOlder()).toBe(true));
    await scroll(() => timeline.loadOlder());
  } finally {
    dispose();
  }
  expect(fetchPage).toHaveBeenCalledTimes(2);
  return requestTraces;
}

it('keeps a page read again after a session change in the scroll trace', async () => {
  exporter.reset();
  const traces = await readPageAgain((load) =>
    Telemetry.span('channel.scroll', load)
  );
  const scroll = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'channel.scroll');
  expect(traces).toEqual([
    scroll?.spanContext().traceId,
    scroll?.spanContext().traceId,
  ]);
});

it('keeps a page and its read again in one trace when the scroll has none', async () => {
  exporter.reset();
  const traces = await readPageAgain((load) => load());
  const page = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'channel.load_page');
  expect(page?.parentSpanContext).toBeUndefined();
  expect(traces).toEqual([
    page?.spanContext().traceId,
    page?.spanContext().traceId,
  ]);
});

it('asks the server about a send in the recovery trace, after each wait too', async () => {
  vi.useFakeTimers();
  try {
    exporter.reset();
    const id = graphqlMessage(7).id;
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const device = writeHost();
    const lookupTraces: (string | undefined)[] = [];
    const writes = createChannelWrites({
      host: device.host,
      runtime: { notifyChanged: vi.fn() },
      client: () => client,
      now: () => NOW,
      fetchMessage: async () => {
        lookupTraces.push(trace.getActiveSpan()?.spanContext().traceId);
        throw new Error('offline');
      },
    });
    const sending = writes.send(send(id));
    let failure: unknown;
    const answered = (async () => {
      try {
        await sending;
      } catch (error) {
        failure = error;
      }
    })();
    await vi.advanceTimersByTimeAsync(0);
    device.settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await answered;
    expect(thrownResultErrorHasCode(failure, 'DELIVERY_UNKNOWN')).toBe(true);
    const recover = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'channel.write.recover');
    const traceId = recover?.spanContext().traceId;
    expect(traceId).toBeDefined();
    expect(lookupTraces).toEqual([traceId, traceId, traceId]);
  } finally {
    vi.useRealTimers();
  }
});
