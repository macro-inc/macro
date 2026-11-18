import { expect, test } from 'bun:test';
import { Telemetry } from '@macro-inc/observability/core';
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
import { setupTraceparentVariable, traceStart } from '../telemetry.ts';

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
);

test("the start joins the computer's setup trace, its steps and work begun in it are its children, and the event loop stays outside", async () => {
  exporter.reset();
  const setupTrace = '0af7651916cd43dd8448eb211c80319c';
  const setupSpan = 'b7ad6b7169203331';
  const outside = Telemetry.captureContext();
  let loop: Promise<void> | undefined;

  const { value } = await traceStart(
    { [setupTraceparentVariable]: `00-${setupTrace}-${setupSpan}-01` },
    async (phase) => {
      await phase('agent.start.checks', async () => undefined);
      void Telemetry.span('agent.greeting', async () => undefined);
      loop = outside.run(() =>
        Telemetry.span('agent.wake', async () => undefined)
      );
      return { value: 7 };
    }
  );
  await loop;

  expect(value).toBe(7);
  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  const start = spans['agent.start'];
  expect(start?.spanContext().traceId).toBe(setupTrace);
  expect(start?.parentSpanContext?.spanId).toBe(setupSpan);
  for (const child of ['agent.start.checks', 'agent.greeting']) {
    expect(spans[child]?.parentSpanContext?.spanId).toBe(
      start?.spanContext().spanId
    );
  }
  expect(spans['agent.wake']?.spanContext().traceId).not.toBe(setupTrace);
  expect(spans['agent.wake']?.parentSpanContext).toBeUndefined();
});

test('without a setup trace the start is a trace of its own, timed from the process start', async () => {
  exporter.reset();
  const before = Date.now() - process.uptime() * 1000;
  await traceStart({}, async () => undefined);

  const [start] = exporter.getFinishedSpans();
  expect(start?.name).toBe('agent.start');
  expect(start?.parentSpanContext).toBeUndefined();
  const startedMs = start
    ? start.startTime[0] * 1000 + start.startTime[1] / 1e6
    : 0;
  expect(Math.abs(startedMs - before)).toBeLessThan(50);
});

test('a failed step marks it and the start failed, and still ends both', async () => {
  exporter.reset();
  const failure = new Error('no claude');

  await expect(
    traceStart({}, async (phase) =>
      phase('agent.start.checks', async () => {
        throw failure;
      })
    )
  ).rejects.toBe(failure);

  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  expect(spans['agent.start.checks']?.status.code).toBe(SpanStatusCode.ERROR);
  expect(spans['agent.start']?.status.code).toBe(SpanStatusCode.ERROR);
});
