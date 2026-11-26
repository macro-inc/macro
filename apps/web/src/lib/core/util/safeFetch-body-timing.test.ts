import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, trace } from '@opentelemetry/api';
import { hrTimeToMilliseconds } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { safeFetch } from './safeFetch';

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock('./platformFetch', () => ({ platformFetch: mocks.fetch }));

context.setGlobalContextManager(new StackContextManager().enable());
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
  vi.restoreAllMocks();
  mocks.fetch.mockReset();
  exporter.reset();
});

it('keeps the span ending at the headers and records the body time once it is read', async () => {
  // Like the native transport, the body is read only when something asks.
  let bodyRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    bodyRequested = resolve;
  });
  let deliverBody!: () => void;
  const delivered = new Promise<void>((resolve) => {
    deliverBody = resolve;
  });
  const body = new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        bodyRequested();
        await delivered;
        controller.enqueue(new TextEncoder().encode('{"items":[1]}'));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  mocks.fetch.mockResolvedValueOnce(
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );

  const result = safeFetch<{ items: number[] }>('https://api.example/items');
  await requested;
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  const bodyStarted = performance.timeOrigin + performance.now();
  deliverBody();

  expect((await result)._unsafeUnwrap()).toEqual({ items: [1] });
  const [span] = exporter.getFinishedSpans();
  expect(span.name).toBe('http GET /items');
  expect(span.attributes['http.timing_scope']).toBe('until_response_headers');
  expect(span.attributes['http.body_outcome']).toBe('complete');
  expect(span.attributes['http.body_ms']).toEqual(expect.any(Number));
  expect(hrTimeToMilliseconds(span.endTime)).toBeLessThanOrEqual(bodyStarted);
});

it('ends the span of a failed response whose body nobody reads', async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response('{"error":"missing"}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  const result = await safeFetch('https://api.example/items/1');

  expect(result.isErr()).toBe(true);
  const [span] = exporter.getFinishedSpans();
  expect(span.attributes['http.status_code']).toBe(404);
  expect(span.attributes['http.body_outcome']).toBe('unread');
  expect(span.attributes['http.body_ms']).toBeUndefined();
});

it('times the body a custom error handler reads', async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response('{"message":"slow down"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  const result = await safeFetch<{}, 'RATE_LIMITED'>(
    'https://api.example/items',
    undefined,
    async (response) => {
      const { message } = (await response.json()) as { message: string };
      return { code: 'RATE_LIMITED', message };
    }
  );

  expect(result.isErr()).toBe(true);
  const [span] = exporter.getFinishedSpans();
  expect(span.attributes['http.body_outcome']).toBe('complete');
});

it('records a body that breaks mid-read and is not retried', async () => {
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode('{"items":'));
      controller.error(new TypeError('network connection was lost'));
    },
  });
  mocks.fetch.mockResolvedValue(
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );

  const result = await safeFetch('https://api.example/items', {
    retry: { maxTries: 3, delay: 0 },
  });

  expect(result._unsafeUnwrapErr()[0]?.code).toBe('NETWORK_ERROR');
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.attributes['http.body_outcome']).toBe('error');
});

it('keeps the duration to the headers when the wall clock ran ahead of the monotonic one', async () => {
  // After a device sleeps, `Date.now()` has moved on and `performance.now()`
  // has not; the SDK starts spans from the wall clock.
  const wallClock = Date.now;
  vi.spyOn(Date, 'now').mockImplementation(() => wallClock() + 10_000);
  mocks.fetch.mockResolvedValueOnce(
    new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  );

  await safeFetch('https://api.example/items');

  const [span] = exporter.getFinishedSpans();
  const startMs = hrTimeToMilliseconds(span.startTime);
  const endMs = hrTimeToMilliseconds(span.endTime);
  expect(endMs).toBeGreaterThan(startMs);
  expect(endMs - startMs).toBeLessThan(1_000);
  expect(span.attributes['http.body_outcome']).toBe('complete');
});

it('records one unread span per retried server error', async () => {
  mocks.fetch.mockImplementation(async () => new Response('', { status: 500 }));

  const result = await safeFetch('https://api.example/items', {
    retry: { maxTries: 2, delay: 0 },
  });

  expect(result._unsafeUnwrapErr()[0]?.code).toBe('SERVER_ERROR');
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(2);
  expect(spans.map((span) => span.attributes['http.body_outcome'])).toEqual([
    'unread',
    'unread',
  ]);
});

it('records a body the caller aborted mid-read', async () => {
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    pull: (streamController) => {
      streamController.enqueue(new TextEncoder().encode('{"items":'));
      controller.abort();
      streamController.error(new DOMException('aborted', 'AbortError'));
    },
  });
  mocks.fetch.mockResolvedValueOnce(
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );

  await safeFetch('https://api.example/items', { signal: controller.signal });

  const [span] = exporter.getFinishedSpans();
  expect(span.attributes['http.body_outcome']).toBe('aborted');
});
