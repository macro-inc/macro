import {
  context,
  propagation,
  ROOT_CONTEXT,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, expect, test, vi } from 'vitest';
import { Tracing } from './tracing';
import { createWebTracingProvider } from './web';

const exporters: InMemorySpanExporter[] = [];
vi.mock('@opentelemetry/exporter-trace-otlp-http', async () => {
  const { InMemorySpanExporter } = await import(
    '@opentelemetry/sdk-trace-base'
  );
  return {
    OTLPTraceExporter: class extends InMemorySpanExporter {
      constructor() {
        super();
        exporters.push(this);
      }
    },
  };
});

afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

test('recording exports even unsampled-parent spans with launch identity and memory at both boundaries', async () => {
  let memory = 100;
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
      recording: true,
      spanAttributes: () => ({ 'macro.memory.native.rss_bytes': memory }),
    },
    resourceFromAttributes({
      'app.runtime': 'tauri',
      'service.instance.id': 'launch-1',
      'macro.recording.id': 'recording-1',
    }),
    () => 'user-1',
    true
  );
  const parent = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '11111111111111111111111111111111',
    spanId: '2222222222222222',
    traceFlags: TraceFlags.NONE,
    isRemote: true,
  });
  const span = provider
    .getTracer('test')
    .startSpan('open.document', {}, parent);
  memory = 200;
  span.end();
  await provider.forceFlush();
  const exported = exporters.at(-1)?.getFinishedSpans()[0];
  expect(exported?.resource.attributes).toMatchObject({
    'app.runtime': 'tauri',
    'service.instance.id': 'launch-1',
    'macro.recording.id': 'recording-1',
  });
  expect(exported?.attributes).toMatchObject({
    'usr.id': 'user-1',
    'macro.memory.native.rss_bytes': 100,
    'macro.memory.native.rss_bytes.end': 200,
  });
  await provider.shutdown();
});

test('buffered samples retain their native timestamp and values despite live enrichment', async () => {
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
      spanAttributes: () => ({ 'macro.memory.native.rss_bytes': 999 }),
    },
    resourceFromAttributes({}),
    () => undefined,
    true
  );
  new Tracing().recordSample(
    'app.memory.sample',
    { 'macro.memory.native.rss_bytes': 123 },
    1_700_000_000_125
  );
  await provider.forceFlush();
  const sample = exporters.at(-1)?.getFinishedSpans()[0];
  expect(sample?.startTime).toEqual([1_700_000_000, 125_000_000]);
  expect(sample?.endTime).toEqual(sample?.startTime);
  expect(sample?.attributes['macro.memory.native.rss_bytes']).toBe(123);
  await provider.shutdown();
});

test('an unsampled session drops perf traces with their children but keeps other traces', async () => {
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
      perfSampleRate: 0,
    },
    resourceFromAttributes({}),
    () => undefined,
    false
  );
  const tracing = new Tracing();
  const flow = tracing.perfSpan('home.load');
  flow.span('home.load.soup').end();
  flow.end();
  tracing.span('doc.open').end();
  await provider.forceFlush();
  expect(
    exporters
      .at(-1)
      ?.getFinishedSpans()
      .map((span) => span.name)
  ).toEqual(['doc.open']);
  await provider.shutdown();
});

test('a sampled session exports perf traces tagged with their class', async () => {
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
      perfSampleRate: 1,
    },
    resourceFromAttributes({}),
    () => undefined,
    true
  );
  new Tracing().perfSpan('home.load').end();
  await provider.forceFlush();
  expect(exporters.at(-1)?.getFinishedSpans()[0]?.attributes).toMatchObject({
    'macro.trace.class': 'perf',
  });
  await provider.shutdown();
});

test('descendants of a perf span carry its class, including client spans in its context', async () => {
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
      perfSampleRate: 1,
    },
    resourceFromAttributes({}),
    () => undefined,
    true
  );
  const tracing = new Tracing();
  const flow = tracing.perfSpan('view.home');
  const phase = flow.span('home.items');
  phase.run(() => tracing.clientSpan('http GET /items').end());
  phase.end();
  flow.end();
  tracing.span('doc.open').end();
  await provider.forceFlush();
  const classes = Object.fromEntries(
    (exporters.at(-1)?.getFinishedSpans() ?? []).map((span) => [
      span.name,
      span.attributes['macro.trace.class'],
    ])
  );
  expect(classes).toEqual({
    'http GET /items': 'perf',
    'home.items': 'perf',
    'view.home': 'perf',
    'doc.open': undefined,
  });
  await provider.shutdown();
});

test('early spans keep explicit async parentage and wait for exporter enablement', async () => {
  let decide: (enabled: boolean) => void = () => {};
  const decision = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const count = exporters.length;
  const { StackContextManager } = await import('./web');
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      tracesUrl: 'http://localhost/v1/traces',
      enabled: () => decision,
      contextManager: new StackContextManager(),
    },
    resourceFromAttributes({}),
    () => undefined,
    true
  );
  const tracing = new Tracing();
  tracing.init(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: () => decision,
      tracingProvider: () => provider,
    },
    resourceFromAttributes({}),
    () => undefined,
    true
  );
  const boot = tracing.perfSpan('app.boot', 1700000000000);
  const document = boot.span('doc.open');
  await Promise.resolve();
  const load = document.span('doc.load');
  load.end();
  const mutation = boot.span('graphql.mutation_queue.attempt');
  await Promise.resolve();
  const transport = mutation.run(() => tracing.clientSpan('graphql.transport'));
  const headers: Record<string, string> = {};
  transport.injectTraceHeaders(headers);
  expect(headers).toEqual({});
  expect(boot.traceparent()).toBeUndefined();
  transport.end();
  mutation.end();
  document.end();
  boot.event('macro.boot.render-start', undefined, 1700000000050);
  boot.end(1700000000100);
  expect(exporters).toHaveLength(count);
  decide(true);
  await tracing.flush();
  expect(boot.traceparent()).toBeDefined();
  const spans = exporters.at(-1)?.getFinishedSpans() ?? [];
  const root = spans.find((span) => span.name === 'app.boot');
  expect(root?.startTime).toEqual([1700000000, 0]);
  expect(root?.endTime).toEqual([1700000000, 100000000]);
  expect(root?.events[0].time).toEqual([1700000000, 50000000]);
  expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
  expect(
    spans.find((span) => span.name === 'doc.load')?.parentSpanContext?.spanId
  ).toBe(spans.find((span) => span.name === 'doc.open')?.spanContext().spanId);
  expect(
    spans.find((span) => span.name === 'graphql.transport')?.parentSpanContext
      ?.spanId
  ).toBe(
    spans
      .find((span) => span.name === 'graphql.mutation_queue.attempt')
      ?.spanContext().spanId
  );
  await provider.shutdown();
});
