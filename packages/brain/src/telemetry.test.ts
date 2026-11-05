import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { ConfigError } from './config.ts';
import { judge } from './jev.ts';
import { telemetryConfig, tracedFetch, withSpan } from './telemetry.ts';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(provider);

Deno.test('telemetry rejects malformed endpoint and parent instead of disabling export', () => {
  for (const value of [
    '',
    'grpc://localhost',
    'http://user:secret@localhost/v1/traces',
    'http://localhost/v1/traces?secret=x',
  ]) {
    assertThrows(
      () =>
        telemetryConfig((name) =>
          name === 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT' ? value : undefined
        ),
      ConfigError
    );
  }
  assertThrows(
    () =>
      telemetryConfig((name) =>
        name === 'BRAIN_PROVISION_TRACEPARENT'
          ? '00-00000000000000000000000000000000-1111111111111111-01'
          : undefined
      ),
    ConfigError
  );
  assertEquals(
    telemetryConfig(() => undefined),
    { endpoint: undefined, traceparent: undefined }
  );
});

Deno.test('concurrent async work injects its own parent and marks failed HTTP responses', async () => {
  exporter.reset();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const headers: string[] = [];
  const send = tracedFetch((_input, init) => {
    headers.push(new Headers(init?.headers).get('traceparent') ?? '');
    return Promise.resolve(new Response(null, { status: 503 }));
  });
  const first = withSpan('first', {}, async () => {
    entered.resolve();
    await release.promise;
    await send('http://127.0.0.1/private');
  });
  await entered.promise;
  await withSpan('second', {}, async () => {
    await send('http://127.0.0.1/private');
  });
  release.resolve();
  await first;
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  const firstSpan = spans.find((s) => s.name === 'first')!;
  const secondSpan = spans.find((s) => s.name === 'second')!;
  assertEquals(headers[0].split('-')[1], secondSpan.spanContext().traceId);
  assertEquals(headers[1].split('-')[1], firstSpan.spanContext().traceId);
  for (const span of spans.filter((s) => s.name === 'brain.macro.request')) {
    assertEquals(span.status.code, SpanStatusCode.ERROR);
    assertEquals(span.attributes['http.response.status_code'], 503);
    assertEquals(Object.keys(span.attributes).sort(), [
      'http.request.method',
      'http.response.status_code',
    ]);
  }
  await assertRejects(() =>
    withSpan('failed', {}, () => Promise.reject(new Error('private text')))
  );
  assertEquals(exporter.getFinishedSpans().at(-1)?.status, {
    code: SpanStatusCode.ERROR,
  });
});

Deno.test('Jev exports decision metadata without message content', async () => {
  exporter.reset();
  await judge(
    {
      messageId: 'opaque-message',
      channel: 'opaque-channel',
      mentionsMe: true,
      directMessage: false,
      inMyThread: false,
      message: {
        id: 'opaque-message',
        from: 'private sender',
        at: '2026-01-01',
        text: 'private message',
        thread: null,
      },
      recent: [],
    },
    {
      config: () => Promise.reject(new Error('unused')),
      decide: () => Promise.reject(new Error('unused')),
      log: () => Promise.resolve(),
    }
  );
  const span = exporter.getFinishedSpans().at(-1)!;
  assertEquals(span.attributes, {
    'jev.relevant': true,
    'jev.reason': 'mentioned',
  });
});
