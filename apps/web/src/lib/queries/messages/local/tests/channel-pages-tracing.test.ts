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
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';

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
