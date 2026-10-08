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
    () => 'user-1'
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
    () => undefined
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
