import { context, propagation, trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, expect, it, vi } from 'vitest';
import type { TelemetryInitConfig, TelemetryStartupOptions } from './config';
import { TraceSampling } from './sampling';
import { Tracing } from './tracing';
import { createWebTracingProvider, StackContextManager } from './web';

const exporters: InMemorySpanExporter[] = [];
const destinations: Array<string | undefined> = [];
vi.mock('@opentelemetry/exporter-trace-otlp-http', async () => {
  const { InMemorySpanExporter } = await import(
    '@opentelemetry/sdk-trace-base'
  );
  return {
    OTLPTraceExporter: class extends InMemorySpanExporter {
      constructor(options: { url?: string }) {
        super();
        exporters.push(this);
        destinations.push(options.url);
      }
    },
  };
});
afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  exporters.length = 0;
  destinations.length = 0;
});

it('registers immediately, retains early recording spans, and waits for its destination and identity', async () => {
  let resolve: (settings: TelemetryStartupOptions) => void = () => {};
  const startup = new Promise<TelemetryStartupOptions>((done) => {
    resolve = done;
  });
  const config: TelemetryInitConfig = {
    serviceName: 'test',
    environment: 'prod',
    startup,
    enabled: async () => true,
    contextManager: new StackContextManager(),
  };
  const resource = resourceFromAttributes({
    'service.instance.id': startup.then(() => 'launch-1'),
  });
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0 });
  const provider = createWebTracingProvider(
    config,
    resource,
    () => undefined,
    sampling
  );
  const tracing = new Tracing();
  tracing.init(
    { ...config, tracingProvider: () => provider },
    resource,
    () => undefined,
    sampling
  );
  const root = tracing.span('early-recording', { sampling: 'perf' });
  const child = root.span('early-child');
  child.end();
  root.end();
  expect(exporters).toHaveLength(0);
  expect(root.traceparent()).toBeUndefined();
  resolve({
    recording: true,
    tracesUrl: 'http://localhost:4318/custom/v1/traces',
  });
  // A recording keeps every class.
  sampling.decide(() => true);
  await tracing.flush();
  expect(destinations).toEqual(['http://localhost:4318/custom/v1/traces']);
  const spans = exporters[0].getFinishedSpans();
  expect(spans.map((span) => span.name)).toEqual([
    'early-child',
    'early-recording',
  ]);
  expect(spans[0].parentSpanContext?.spanId).toBe(
    spans[1].spanContext().spanId
  );
  expect(
    spans.every(
      (span) => span.resource.attributes['service.instance.id'] === 'launch-1'
    )
  ).toBe(true);
  expect(root.traceparent()).toMatch(/-01$/);
  await tracing.shutdown();
});

it('drops normal unsampled early spans and late children and normalizes both propagation APIs', async () => {
  let resolve: (settings: TelemetryStartupOptions) => void = () => {};
  const startup = new Promise<TelemetryStartupOptions>((done) => {
    resolve = done;
  });
  const config: TelemetryInitConfig = {
    serviceName: 'test',
    environment: 'prod',
    startup,
    tracesUrl: 'http://localhost/v1/traces',
    enabled: async () => true,
    contextManager: new StackContextManager(),
  };
  const tracing = new Tracing();
  const resource = resourceFromAttributes({});
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0.05 });
  tracing.init(
    {
      ...config,
      tracingProvider: (resource, user, sampling) =>
        createWebTracingProvider(config, resource, user, sampling),
    },
    resource,
    () => undefined,
    sampling
  );
  const early = tracing.span('normal-perf', { sampling: 'perf' });
  early.span('early-child').end();
  resolve({ recording: false, tracesUrl: config.tracesUrl });
  sampling.decide(() => false);
  await tracing.flush();
  expect(early.traceparent()).toMatch(/-00$/);
  const headers: Record<string, string> = {};
  early.injectTraceHeaders(headers);
  expect(headers.traceparent).toMatch(/-00$/);
  early.span('late-child').end();
  early.end();
  tracing.span('ordinary').end();
  await tracing.flush();
  expect(exporters[0].getFinishedSpans().map((span) => span.name)).toEqual([
    'ordinary',
  ]);
  await tracing.shutdown();
});

it('constructs no exporter when enablement is denied, including a resolved native destination', async () => {
  const provider = createWebTracingProvider(
    {
      serviceName: 'test',
      environment: 'prod',
      enabled: async () => false,
      startup: Promise.resolve({
        recording: false,
        tracesUrl: 'http://localhost/v1/traces',
      }),
    },
    resourceFromAttributes({}),
    () => undefined,
    new TraceSampling()
  );
  provider.getTracer('test').startSpan('early').end();
  await provider.forceFlush();
  expect(exporters).toHaveLength(0);
  await provider.shutdown();
});

it('preserves sampled normal roots and children across startup resolution', async () => {
  let resolve: (settings: TelemetryStartupOptions) => void = () => {};
  const startup = new Promise<TelemetryStartupOptions>((done) => {
    resolve = done;
  });
  const config: TelemetryInitConfig = {
    serviceName: 'test',
    environment: 'prod',
    startup,
    enabled: async () => true,
    contextManager: new StackContextManager(),
  };
  const tracing = new Tracing();
  const sampling = new TraceSampling();
  sampling.configure({ perf: 0.05 });
  tracing.init(
    {
      ...config,
      tracingProvider: (resource, user, sampling) =>
        createWebTracingProvider(config, resource, user, sampling),
    },
    resourceFromAttributes({}),
    () => undefined,
    sampling
  );
  const early = tracing.span('sampled-perf', { sampling: 'perf' });
  early.span('early-child').end();
  resolve({ recording: false, tracesUrl: 'http://localhost/v1/traces' });
  sampling.decide(() => true);
  await tracing.flush();
  early.span('late-child').end();
  early.end();
  await tracing.flush();
  expect(exporters[0].getFinishedSpans().map((span) => span.name)).toEqual([
    'early-child',
    'late-child',
    'sampled-perf',
  ]);
  expect(early.traceparent()).toMatch(/-01$/);
  await tracing.shutdown();
});

it('fails closed when native startup settings reject', async () => {
  let reject: (error: Error) => void = () => {};
  const startup = new Promise<TelemetryStartupOptions>((_resolve, fail) => {
    reject = fail;
  });
  const provider = createWebTracingProvider(
    {
      serviceName: 'test',
      environment: 'prod',
      enabled: async () => true,
      startup,
    },
    resourceFromAttributes({}),
    () => undefined,
    new TraceSampling()
  );
  provider.getTracer('test').startSpan('early').end();
  reject(new Error('unavailable'));
  await provider.forceFlush();
  expect(exporters).toHaveLength(0);
  await provider.shutdown();
});
