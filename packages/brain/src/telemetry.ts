// Deno has async-local context, so concurrent turns retain independent parents.
// Export only categories, counts and opaque identifiers; never exception text.
import {
  type Attributes,
  context,
  DiagLogLevel,
  diag,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ConfigError } from './config.ts';

export function telemetryConfig(env: (name: string) => string | undefined) {
  const endpoint = env('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
  if (endpoint !== undefined) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ConfigError(
        'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an absolute HTTP(S) URL'
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new ConfigError(
        'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an HTTP(S) URL without credentials, query or fragment'
      );
  }
  const traceparent = env('BRAIN_PROVISION_TRACEPARENT');
  if (
    traceparent !== undefined &&
    (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(traceparent) ||
      /^00-0{32}-/.test(traceparent) ||
      /-0{16}-/.test(traceparent))
  )
    throw new ConfigError(
      'BRAIN_PROVISION_TRACEPARENT must be a valid W3C traceparent'
    );
  return { endpoint, traceparent };
}

let provisionParent = ROOT_CONTEXT;
let provider: BasicTracerProvider | undefined;

export async function initTelemetry(
  env: (name: string) => string | undefined
): Promise<void> {
  const { endpoint, traceparent } = telemetryConfig(env);
  if (!endpoint) {
    console.error(
      JSON.stringify({
        telemetry: 'off',
        reason: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is unset',
      })
    );
    return;
  }
  diag.setLogger(
    {
      error: () =>
        console.error(JSON.stringify({ telemetry: 'export_failed' })),
      warn: () =>
        console.error(JSON.stringify({ telemetry: 'export_warning' })),
      info: () => {},
      debug: () => {},
      verbose: () => {},
    },
    DiagLogLevel.WARN
  );
  const attributes: Attributes = {};
  const user = env('MACRO_AGENT_USER_ID');
  if (user) attributes.agent_user_id = await opaqueId(user);
  for (const [key, variable] of [
    ['team_id', 'MACRO_TEAM_ID'],
    ['computer_id', 'MACRO_COMPUTER_ID'],
  ]) {
    const value = env(variable);
    if (value) {
      if (!/^[0-9a-f-]{36}$/i.test(value))
        throw new ConfigError(`${variable} must be a UUID`);
      attributes[key] = value;
    }
  }
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'brain',
      ...attributes,
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
    ],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable()
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  if (traceparent)
    provisionParent = propagation.extract(ROOT_CONTEXT, { traceparent });
}

export async function opaqueId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function startSpan(name: string, attributes: Attributes = {}): Span {
  const origin = trace.getSpanContext(provisionParent);
  return trace
    .getTracer('brain')
    .startSpan(
      name,
      { attributes, links: origin ? [{ context: origin }] : [] },
      name === 'brain.health' && origin ? provisionParent : context.active()
    );
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>
): Promise<T> {
  const span = startSpan(name, attributes);
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      return await run(span);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function traceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}

/** No URL, body, header values or provider error text is captured. */
export function tracedFetch(send: typeof fetch): typeof fetch {
  return (input, init) => {
    const span = trace
      .getTracer('brain')
      .startSpan('brain.macro.request', {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method':
            init?.method ?? (input instanceof Request ? input.method : 'GET'),
        },
      });
    return context.with(trace.setSpan(context.active(), span), async () => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      for (const [key, value] of Object.entries(traceHeaders()))
        headers.set(key, value);
      try {
        const response = await send(input, { ...init, headers });
        span.setAttribute('http.response.status_code', response.status);
        if (!response.ok) span.setStatus({ code: SpanStatusCode.ERROR });
        return response;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

export async function shutdownTelemetry(): Promise<void> {
  await provider?.shutdown();
}

export async function withRemoteSpan<T>(
  parent: string | null,
  run: () => Promise<T>
): Promise<T> {
  const remote = parent
    ? propagation.extract(ROOT_CONTEXT, { traceparent: parent })
    : context.active();
  return context.with(remote, () => withSpan('brain.control', {}, run));
}
