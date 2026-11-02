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
import { TraceSampling } from './sampling';
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
  const sampling = new TraceSampling();
  sampling.decide(() => true);
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
    sampling
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
  const sampling = new TraceSampling();
  sampling.decide(() => true);
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
    sampling
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

test('an unsampled perf class drops its traces with their phases but keeps unclassed traces', async () => {
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0.05 });
  sampling.decide(() => false);
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const tracing = new Tracing();
  tracing.init(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracingProvider: () => provider,
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const flow = tracing.span('home.load', { sampling: 'perf' });
  flow.span('home.load.soup').end();
  flow.end();
  tracing.span('doc.open').end();
  await tracing.flush();
  expect(
    exporters
      .at(-1)
      ?.getFinishedSpans()
      .map((span) => span.name)
  ).toEqual(['doc.open']);
  expect(flow.traceparent()).toMatch(/-00$/);
  await provider.shutdown();
});

test('every span in a kept classed trace carries its class and rate, including requests started in it', async () => {
  const sampling = new TraceSampling();
  sampling.configure({ always: 1, perf: 0.05 });
  sampling.decide(() => true);
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const tracing = new Tracing();
  tracing.init(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracingProvider: () => provider,
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const flow = tracing.span('view.home', { sampling: 'perf' });
  const phase = flow.span('home.items');
  phase.run(() => tracing.span('http GET /items', { kind: 'client' }).end());
  phase.run(() => tracing.span('cache.write', { sampling: 'always' }).end());
  phase.end();
  flow.end();
  tracing.span('doc.open').end();
  await tracing.flush();
  const tags = Object.fromEntries(
    (exporters.at(-1)?.getFinishedSpans() ?? []).map((span) => [
      span.name,
      [
        span.attributes['macro.sampling.class'],
        span.attributes['macro.sampling.rate'],
      ],
    ])
  );
  expect(tags).toEqual({
    'http GET /items': ['perf', 0.05],
    'cache.write': ['always', 1],
    'home.items': ['perf', 0.05],
    'view.home': ['perf', 0.05],
    'doc.open': [undefined, undefined],
  });
  await provider.shutdown();
});

test('a span in a dropped trace starts its own trace when its class is kept, and is dropped when it is not', async () => {
  const sampling = new TraceSampling();
  sampling.configure({ always: 1, perf: 0.05 });
  sampling.decide((samplingClass) => samplingClass === 'always');
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracesUrl: 'http://localhost/v1/traces',
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const tracing = new Tracing();
  tracing.init(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: async () => true,
      tracingProvider: () => provider,
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const flow = tracing.span('view.home', { sampling: 'perf' });
  const phase = flow.span('home.items');
  phase.run(() => {
    const request = tracing.span('http GET /items', { kind: 'client' });
    request.span('http GET /items.retry').end();
    request.end();
    tracing.span('cache.write', { sampling: 'always' }).end();
    tracing.span('urql.reconcile', { sampling: 'perf' }).end();
  });
  phase.end();
  flow.end();
  await tracing.flush();
  const spans = exporters.at(-1)?.getFinishedSpans() ?? [];
  expect(spans.map((span) => span.name)).toEqual([
    'http GET /items.retry',
    'http GET /items',
    'cache.write',
  ]);
  const [retry, request, write] = spans;
  expect(request.parentSpanContext).toBeUndefined();
  expect(retry.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
  expect(retry.spanContext().traceId).toBe(request.spanContext().traceId);
  expect(write.parentSpanContext).toBeUndefined();
  expect(write.spanContext().traceId).not.toBe(request.spanContext().traceId);
  expect(write.attributes['macro.sampling.class']).toBe('always');
  expect(request.attributes['macro.sampling.class']).toBeUndefined();
  await provider.shutdown();
});

test('a span started in a perf trace before the decision leaves it at export when perf is dropped', async () => {
  let decide: (enabled: boolean) => void = () => {};
  const decision = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0.05 });
  const provider = createWebTracingProvider(
    {
      serviceName: 'web-app',
      environment: 'test',
      enabled: () => decision,
      tracesUrl: 'http://localhost/v1/traces',
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
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
    sampling
  );
  const boot = tracing.span('app.boot', { sampling: 'perf' });
  const request = boot.run(() =>
    tracing.span('http GET /items', { kind: 'client' })
  );
  const parse = request.span('http GET /items.parse');
  parse.end();
  boot.end();
  decide(true);
  sampling.decide(() => false);
  await tracing.flush();
  const headers: Record<string, string> = {};
  request.injectTraceHeaders(headers);
  const late = request.span('http GET /items.read');
  late.end();
  request.end();
  await tracing.flush();
  const spans = exporters.at(-1)?.getFinishedSpans() ?? [];
  expect(spans.map((span) => span.name)).toEqual([
    'http GET /items.parse',
    'http GET /items.read',
    'http GET /items',
  ]);
  const [early, read, root] = spans;
  const traceId = root.spanContext().traceId;
  expect(traceId).not.toBe(boot.traceparent()?.split('-')[1]);
  expect(root.parentSpanContext).toBeUndefined();
  expect(early.spanContext().traceId).toBe(traceId);
  expect(read.spanContext().traceId).toBe(traceId);
  expect(read.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  expect(headers.traceparent).toBe(
    `00-${traceId}-${root.spanContext().spanId}-01`
  );
  await provider.shutdown();
});

test('early spans keep explicit async parentage and wait for exporter enablement', async () => {
  let decide: (enabled: boolean) => void = () => {};
  const decision = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const count = exporters.length;
  const { StackContextManager } = await import('./web');
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0.05 });
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
    sampling
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
    sampling
  );
  const boot = tracing.span('app.boot', {
    sampling: 'perf',
    startTime: 1700000000000,
  });
  const document = boot.span('doc.open');
  await Promise.resolve();
  const load = document.span('doc.load');
  load.end();
  const mutation = boot.span('graphql.mutation_queue.attempt');
  await Promise.resolve();
  const transport = mutation.run(() =>
    tracing.span('graphql.transport', { kind: 'client' })
  );
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
  sampling.decide(() => true);
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
