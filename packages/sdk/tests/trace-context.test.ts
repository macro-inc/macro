import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  type Context,
  type ContextManager,
  context,
  propagation,
  ROOT_CONTEXT,
  type TextMapPropagator,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { Macro } from '../src/macro';

const traceId = '5b8aa5a2d2c872e8321cf37308d69df2';
const spanId = '051581bf3cb55c13';
const traceparent = `00-${traceId}-${spanId}-01`;

// One active span for the whole test, whatever awaits run in between.
const active = trace.setSpanContext(ROOT_CONTEXT, {
  traceId,
  spanId,
  traceFlags: TraceFlags.SAMPLED,
});
const fixed: ContextManager = {
  active: () => active,
  with: (_context, fn, thisArg, ...args) => fn.call(thisArg, ...args),
  bind: (_context, target) => target,
  enable() {
    return this;
  },
  disable() {
    return this;
  },
};
// The W3C header, as a process's registered propagator writes it.
const w3c: TextMapPropagator = {
  inject: (ctx: Context, carrier, setter) => {
    const span = trace.getSpanContext(ctx);
    if (span === undefined) return;
    setter.set(carrier, 'traceparent', `00-${span.traceId}-${span.spanId}-01`);
  },
  extract: (ctx) => ctx,
  fields: () => ['traceparent'],
};

const originalFetch = globalThis.fetch;
let requests: Request[] = [];

beforeEach(() => {
  requests = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      requests.push(input instanceof Request ? input : new Request(input));
      return Response.json({ id: 'macro|me@example.com' });
    },
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  context.disable();
  propagation.disable();
});

const call = async (traceContext?: boolean) => {
  const macro = new Macro({
    token: 'mak_abc',
    hosts: { auth: 'https://auth.test', storage: 'https://storage.test' },
    ...(traceContext === undefined ? {} : { traceContext }),
  });
  await macro._client.myPrincipalId().catch(() => undefined);
  expect(requests.length).toBeGreaterThan(0);
  return requests[0].headers;
};

test('with traceContext, a request carries the active trace context', async () => {
  context.setGlobalContextManager(fixed);
  propagation.setGlobalPropagator(w3c);
  expect((await call(true)).get('traceparent')).toBe(traceparent);
});

test('without it, no trace context is sent even with a propagator and a span', async () => {
  context.setGlobalContextManager(fixed);
  propagation.setGlobalPropagator(w3c);
  expect((await call()).get('traceparent')).toBeNull();
  expect((await call(false)).get('traceparent')).toBeNull();
});

test('with it but no propagator registered, nothing is sent', async () => {
  context.setGlobalContextManager(fixed);
  expect((await call(true)).get('traceparent')).toBeNull();
});
