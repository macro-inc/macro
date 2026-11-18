import { context, propagation, trace } from '@opentelemetry/api';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, expect, it, vi } from 'vitest';
import { createServerTracingProvider } from './server';
import { Telemetry } from './telemetry';

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
afterEach(async () => {
  await Telemetry.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
  exporters.length = 0;
  destinations.length = 0;
});

it('parents spans across awaits and exports them to the configured URL', async () => {
  await Telemetry.init({
    serviceName: 'agent',
    environment: 'test',
    tracesUrl: 'http://127.0.0.1:4318/v1/traces',
    enabled: async () => true,
    tracingProvider: (resource, getUserId, sampling) =>
      createServerTracingProvider(
        { tracesUrl: 'http://127.0.0.1:4318/v1/traces' },
        resource,
        getUserId,
        sampling
      ),
  });
  let traceparent: string | undefined;
  await Telemetry.span('agent.wake', async (wake) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await Telemetry.span('agent.capability_script', async (script) => {
      traceparent = script.traceparent();
    });
    wake.setAttr('outcome', 'done');
  });
  await Telemetry.flush();

  expect(destinations).toEqual(['http://127.0.0.1:4318/v1/traces']);
  const spans = exporters.flatMap((exporter) => exporter.getFinishedSpans());
  const wake = spans.find((span) => span.name === 'agent.wake');
  const script = spans.find((span) => span.name === 'agent.capability_script');
  expect(wake?.attributes.outcome).toBe('done');
  expect(script?.parentSpanContext?.spanId).toBe(wake?.spanContext().spanId);
  expect(traceparent).toContain(wake?.spanContext().traceId ?? 'missing');
});

it('exports nothing without a traces URL', async () => {
  await Telemetry.init({
    serviceName: 'agent',
    environment: 'test',
    enabled: async () => true,
    tracingProvider: (resource, getUserId, sampling) =>
      createServerTracingProvider({}, resource, getUserId, sampling),
  });
  await Telemetry.span('agent.wake', async () => {});
  await Telemetry.flush();
  expect(exporters).toEqual([]);
});
