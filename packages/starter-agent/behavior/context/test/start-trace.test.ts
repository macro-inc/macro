import { afterAll, beforeAll, expect, test } from 'bun:test';
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
import {
  launchTimings,
  launchTimingsVariable,
  setupTraceparentVariable,
  traceStart,
} from '../telemetry.ts';

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();

// The OTel API is global: register for these tests only, and leave nothing behind.
beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
  );
});

afterAll(() => {
  trace.disable();
  propagation.disable();
  context.disable();
});

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
  // The process has been running a while, so its start is well before now.
  await Bun.sleep(5);
  const called = Date.now();
  const before = called - process.uptime() * 1000;
  await traceStart({}, async (phase) =>
    phase('agent.start.checks', async () => undefined)
  );

  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  const start = spans['agent.start'];
  expect(start?.parentSpanContext).toBeUndefined();
  const checks = spans['agent.start.checks'];
  const checksMs = checks
    ? checks.startTime[0] * 1000 + checks.startTime[1] / 1e6
    : 0;
  const startMs = start
    ? start.startTime[0] * 1000 + start.startTime[1] / 1e6
    : 0;
  // Loading the code before the call counts toward the start.
  expect(checksMs - startMs).toBeGreaterThanOrEqual(called - before - 50);
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

test('the start ends while the event loop it began keeps running', async () => {
  exporter.reset();
  const forever = new Promise<void>(() => undefined);

  const { running } = await traceStart({}, async () => ({ running: forever }));

  expect(running).toBe(forever);
  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
    'agent.start',
  ]);
});

test('what ran before the start (loading the code, telemetry) is shown as its first steps', async () => {
  exporter.reset();
  const processStart = Date.now() - process.uptime() * 1000;
  const loaded = processStart + 1_200;
  const telemetry = loaded + 300;

  await traceStart({}, async () => undefined, [
    { name: 'agent.start.load', end: loaded },
    { name: 'agent.start.telemetry', start: loaded, end: telemetry },
  ]);

  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  const ms = (time: [number, number] | undefined) =>
    time === undefined ? 0 : time[0] * 1000 + time[1] / 1e6;
  const start = spans['agent.start'];
  const load = spans['agent.start.load'];
  const setup = spans['agent.start.telemetry'];
  for (const step of [load, setup])
    expect(step?.parentSpanContext?.spanId).toBe(start?.spanContext().spanId);
  // Loading starts with the process, as the start does.
  expect(Math.abs(ms(load?.startTime) - ms(start?.startTime))).toBeLessThan(50);
  expect(Math.abs(ms(load?.endTime) - loaded)).toBeLessThan(5);
  expect(Math.abs(ms(setup?.startTime) - loaded)).toBeLessThan(5);
  expect(Math.abs(ms(setup?.endTime) - telemetry)).toBeLessThan(5);
});

const milliseconds = ([seconds, nanoseconds]: readonly [number, number]) =>
  seconds * 1000 + nanoseconds / 1e6;

test("the launcher's steps are agent.launch spans under the start, which begins with the launcher", async () => {
  exporter.reset();
  const timings =
    'started:1795000000000000,clone:1795000000010000:1795000000250000,lockfile:1795000000250000:1795000000300500,exec:1795000000301000';

  await traceStart({ [launchTimingsVariable]: timings }, async (phase) =>
    phase('agent.start.checks', async () => undefined)
  );

  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  const start = spans['agent.start'];
  const launch = spans['agent.launch'];
  expect(milliseconds(start?.startTime ?? [0, 0])).toBe(1795000000000);
  expect(launch?.parentSpanContext?.spanId).toBe(start?.spanContext().spanId);
  expect(milliseconds(launch?.startTime ?? [0, 0])).toBe(1795000000000);
  expect(milliseconds(launch?.endTime ?? [0, 0])).toBe(1795000000301);
  const clone = spans['agent.launch.clone'];
  expect(clone?.parentSpanContext?.spanId).toBe(launch?.spanContext().spanId);
  expect(milliseconds(clone?.startTime ?? [0, 0])).toBe(1795000000010);
  expect(milliseconds(clone?.endTime ?? [0, 0])).toBe(1795000000250);
  expect(
    milliseconds(spans['agent.launch.lockfile']?.endTime ?? [0, 0])
  ).toBeCloseTo(1795000000300.5, 3);
  expect(spans['agent.start.checks']?.parentSpanContext?.spanId).toBe(
    start?.spanContext().spanId
  );
});

test('malformed launcher timings are ignored', () => {
  expect(launchTimings(undefined)).toBeUndefined();
  expect(launchTimings('')).toBeUndefined();
  expect(launchTimings('started:1,exec:x')).toBeUndefined();
  expect(launchTimings('started:1,clone:2,exec:3')).toBeUndefined();
  expect(launchTimings('started:1000,exec:3000')).toEqual({
    started: 1,
    steps: [],
    ended: 3,
  });
});

test("the launcher's steps come before the process's own first steps, all under the start", async () => {
  exporter.reset();
  const processStart = Date.now() - process.uptime() * 1000;
  const micros = (ms: number) => String(Math.round(ms * 1000));
  const timings = `started:${micros(processStart - 500)},settings:${micros(processStart - 500)}:${micros(processStart - 400)},exec:${micros(processStart - 10)}`;

  await traceStart(
    { [launchTimingsVariable]: timings },
    async () => undefined,
    [{ name: 'agent.start.load', end: processStart + 100 }]
  );

  const spans = Object.fromEntries(
    exporter.getFinishedSpans().map((span) => [span.name, span])
  );
  const start = spans['agent.start'];
  const launch = spans['agent.launch'];
  const load = spans['agent.start.load'];
  for (const child of [launch, load])
    expect(child?.parentSpanContext?.spanId).toBe(start?.spanContext().spanId);
  expect(milliseconds(start?.startTime ?? [0, 0])).toBeCloseTo(
    processStart - 500,
    0
  );
  expect(milliseconds(launch?.endTime ?? [0, 0])).toBeLessThanOrEqual(
    milliseconds(load?.startTime ?? [0, 0])
  );
});
