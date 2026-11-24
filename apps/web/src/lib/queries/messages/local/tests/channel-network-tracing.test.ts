import {
  captureTraceParentExchange,
  traceParentExchange,
} from '@app/lib/urql-solid/trace-parent-exchange';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { beforeAll, expect, it, vi } from 'vitest';
import { createChannelWrites } from '../channel-writes';
import { graphqlMessage } from './fixtures';
import { fakeClient, NOW, send, writeHost } from './write-fixtures';

const network = vi.hoisted(() => ({ client: undefined as Client | undefined }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => network.client,
}));

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

it('keeps a lookup the cache sends again, after another tab commits a write, in the recovery trace', async () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  const message = graphqlMessage(7);
  const device = writeHost();
  const cache = { ...createNoopCacheHost(), ...device.host, disabled: false };
  const firstAnswer = Promise.withResolvers<Response>();
  const parents: (string | undefined)[] = [];
  const serverHasIt = () =>
    new Response(
      JSON.stringify({ data: { user: { channelMessage: message } } }),
      { headers: { 'content-type': 'application/json' } }
    );
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [
      captureTraceParentExchange,
      normalizedCacheExchange(cache, { signal: lifetime.signal }),
      traceParentExchange,
      fetchExchange,
    ],
    fetch: async () => {
      parents.push(trace.getActiveSpan()?.spanContext().spanId);
      return parents.length === 1 ? firstAnswer.promise : serverHasIt();
    },
  });
  const { client } = fakeClient(() => ({
    disposition: { kind: 'queued', transactionId: '4' },
  }));
  const writes = createChannelWrites({
    host: cache,
    runtime: { notifyChanged: vi.fn() },
    client: () => client,
    now: () => NOW,
  });
  const sent = writes.send(send(message.id));
  try {
    await vi.advanceTimersByTimeAsync(0);
    device.settle({
      transactionId: '4',
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
      error: 'stopped after 3 server failures',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(parents).toHaveLength(1);
    // Another tab's write lands while the lookup is out: the cache drops
    // the older answer and asks again.
    device.settle({
      status: 'committed',
      transactionId: 'other-tab-transaction',
      mutationUuid: 'other-send',
    });
    firstAnswer.resolve(serverHasIt());
    await vi.advanceTimersByTimeAsync(0);
    expect((await sent).id).toBe(message.id);
    const recovery = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'channel.write.recover');
    const parent = recovery?.spanContext().spanId;
    expect(parent).toBeDefined();
    expect(parents).toEqual([parent, parent]);
  } finally {
    lifetime.abort();
    vi.useRealTimers();
  }
});
