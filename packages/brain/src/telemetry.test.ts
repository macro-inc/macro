import assert from 'node:assert/strict';
import { test } from 'node:test';
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
import { EventLog } from './calls/events.ts';
import { SpeechGateway } from './calls/speech.ts';
import { ConfigError } from './config.ts';
import { judge } from './jev.ts';
import { AgentSdkRunner } from './runner.ts';
import {
  telemetryConfig,
  tracedFetch,
  traceHeaders,
  withSpan,
} from './telemetry.ts';
import { gitCli } from './workspace.ts';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(provider);
test('native call callbacks retain their call parent without exporting transcript text', async () => {
  exporter.reset();
  const { log, gateway } = await withSpan('brain.call', {}, async () => ({
    log: new EventLog(null),
    gateway: new SpeechGateway(
      'http://localhost/inference',
      'test-key',
      'Agent'
    ),
  }));
  log.emit('room.first_frame');
  log.emit('stt.final', { text: 'private speech', turn: 1 });
  log.close();
  const spans = exporter.getFinishedSpans();
  const parent = spans.find((span) => span.name === 'brain.call');
  assert.ok(parent);
  assert.equal(
    gateway.headers().traceparent,
    `00-${parent.spanContext().traceId}-${parent.spanContext().spanId}-01`
  );
  const children = spans.filter((span) => span.name !== 'brain.call');
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.spanContext().traceId, parent.spanContext().traceId);
    assert.equal(child.parentSpanContext?.spanId, parent.spanContext().spanId);
    assert.equal(
      JSON.stringify(child.attributes).includes('private speech'),
      false
    );
  }
});
test('telemetry rejects malformed endpoint and parent instead of disabling export', () => {
  for (const value of [
    '',
    'grpc://localhost',
    'http://user:secret@localhost/v1/traces',
    'http://localhost/v1/traces?secret=x',
  ]) {
    assert.throws(
      () =>
        telemetryConfig((name) =>
          name === 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT' ? value : undefined
        ),
      ConfigError
    );
  }
  assert.throws(
    () =>
      telemetryConfig((name) =>
        name === 'BRAIN_PROVISION_TRACEPARENT'
          ? '00-00000000000000000000000000000000-1111111111111111-01'
          : undefined
      ),
    ConfigError
  );
  assert.deepEqual(
    telemetryConfig(() => undefined),
    { endpoint: undefined, traceparent: undefined }
  );
});
test('concurrent async work injects its own parent and marks failed HTTP responses', async () => {
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
  assert.deepEqual(headers[0].split('-')[1], secondSpan.spanContext().traceId);
  assert.deepEqual(headers[1].split('-')[1], firstSpan.spanContext().traceId);
  for (const span of spans.filter((s) => s.name === 'brain.macro.request')) {
    assert.deepEqual(span.status.code, SpanStatusCode.ERROR);
    assert.deepEqual(span.attributes['http.response.status_code'], 503);
    assert.deepEqual(Object.keys(span.attributes).sort(), [
      'http.request.method',
      'http.response.status_code',
    ]);
  }
  await assert.rejects(() =>
    withSpan('failed', {}, () => Promise.reject(new Error('private text')))
  );
  assert.deepEqual(exporter.getFinishedSpans().at(-1)?.status, {
    code: SpanStatusCode.ERROR,
  });
});
test('Jev exports decision metadata without message content', async () => {
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
  assert.deepEqual(span.attributes, {
    'jev.relevant': true,
    'jev.reason': 'mentioned',
  });
});
test('a synchronous SDK startup failure closes its span without error text', () => {
  exporter.reset();
  const runner = new AgentSdkRunner({
    query: () => {
      throw new Error('private startup details');
    },
    claudeExecutable: 'claude',
    anthropicBaseUrl: 'http://127.0.0.1',
    anthropicAuthToken: 'test-token',
    claudeConfigDir: '/tmp/brain-test',
    baseEnv: {},
  });
  assert.throws(() =>
    runner.start({
      id: 'test-turn',
      tier: 'respond',
      lane: 'opaque-lane',
      prompt: 'private prompt',
      system: 'private system',
      cwd: '/tmp/brain-test',
      model: 'test-model',
      maxBudgetUsd: 1,
      env: {},
    })
  );
  const span = exporter.getFinishedSpans().at(-1)!;
  assert.deepEqual(span.name, 'brain.turn');
  assert.deepEqual(span.status, { code: SpanStatusCode.ERROR });
  assert.deepEqual(span.attributes, {
    'brain.tier': 'respond',
    'gen_ai.request.model': 'test-model',
    'turn.id': 'test-turn',
    'brain.lane': 'opaque-lane',
  });
  assert.deepEqual(span.events, []);
});
test('git subprocess config carries its active trace without persisting it', async () => {
  await withSpan('git.parent', {}, async () => {
    const expected = `traceparent: ${traceHeaders().traceparent}`;
    const result = await gitCli('/tmp')([
      'config',
      '--get-all',
      'http.extraHeader',
    ]);
    assert.deepEqual(result.code, 0);
    assert.deepEqual(result.stdout.trim().split('\n').includes(expected), true);
  });
});
