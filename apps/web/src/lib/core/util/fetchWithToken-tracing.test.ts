import { type Span, Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { withCallbacks } from '@queries/utils';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fetchWithToken, unsetTokenPromise } from './fetchWithToken';

context.setGlobalContextManager(new StackContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
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
afterEach(() => {
  vi.unstubAllGlobals();
  unsetTokenPromise();
  exporter.reset();
});

it('keeps a refresh and retried request under the admitted action with synchronous context', async () => {
  unsetTokenPromise();
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ saved: true }));
  vi.stubGlobal('fetch', request);
  const action = Telemetry.span('save.action');
  const pending = action.run(() =>
    fetchWithToken(`${window.location.origin}/resource`)
  );
  const other = Telemetry.span('unrelated.action');
  other.run(() => Telemetry.span('unrelated.child').end());
  other.end();
  expect((await pending).isOk()).toBe(true);
  action.end();
  expect(request).toHaveBeenCalledTimes(3);
  const spans = exporter.getFinishedSpans();
  const root = spans.find((span) => span.name === 'save.action')!;
  const requests = spans.filter((span) => span.name.startsWith('http '));
  expect(requests).toHaveLength(3);
  for (const span of requests) {
    expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(span.spanContext().traceId).toBe(root.spanContext().traceId);
  }
  const resources = request.mock.calls.filter(([url]) =>
    String(url).endsWith('/resource')
  );
  expect(resources).toHaveLength(2);
  for (const [, init] of resources) {
    expect(new Headers(init?.headers).get('traceparent')?.split('-')[1]).toBe(
      root.spanContext().traceId
    );
  }
});

it('restores a queued mutation parent for default and override callbacks after awaits', async () => {
  const client = new QueryClient();
  type Input = { parentSpan: Span };
  const observer = new MutationObserver(client, {
    mutationFn: async (input: Input) =>
      input.parentSpan.run(() =>
        Telemetry.span('mutation.request', async () => 42)
      ),
    ...withCallbacks<number, Error, Input>(
      {
        onSuccess: async () => {
          await Promise.resolve();
          Telemetry.span('default.local').end();
        },
      },
      {
        onSuccess: () => {
          Telemetry.span('override.refresh').end();
        },
        onSettled: () => {
          Telemetry.span('settled.refresh').end();
        },
      },
      (input) => input.parentSpan
    ),
  });
  const root = Telemetry.span('mutation.action');
  expect(await observer.mutate({ parentSpan: root })).toBe(42);
  root.end();
  const spans = exporter.getFinishedSpans();
  const action = spans.find((span) => span.name === 'mutation.action')!;
  for (const name of [
    'mutation.request',
    'override.refresh',
    'settled.refresh',
  ]) {
    expect(
      spans.find((span) => span.name === name)?.parentSpanContext?.spanId
    ).toBe(action.spanContext().spanId);
  }
  // A callback's own continuation still needs an explicit parent; the helper
  // guarantees callback admission, without patching async execution.
  expect(
    spans.find((span) => span.name === 'default.local')?.parentSpanContext
  ).toBeUndefined();
  client.clear();
});
