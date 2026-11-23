import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, expect, it, vi } from 'vitest';
import { type FetchChannelServerPage, loadChannelPage } from '../channel-pages';
import {
  type FetchChannelThreadPage,
  loadChannelThread,
} from '../channel-thread';
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';
import { send, setup, written } from './write-fixtures';

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
    { host, touches: { due: () => undefined }, fetchPage },
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
