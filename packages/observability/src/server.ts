// Bun and Node entry: a tracer provider for long-running server processes
// (an agent teammate's runtime). Context follows async calls through
// AsyncLocalStorage, so spans parent across awaits without passing them.
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Resource } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { TelemetryInitConfig } from './config';
import { ATTR_USER_ID } from './constants';
import { userIdSuppressed } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import type { TraceSampling } from './sampling';

/** Creates the tracer provider of a Bun or Node server process. */
export function createServerTracingProvider(
  config: Pick<TelemetryInitConfig<string>, 'tracesUrl'> & {
    /** Extra headers for the export request. */
    readonly tracesHeaders?: Record<string, string>;
  },
  resource: Resource,
  getUserId: () => string | undefined,
  sampling: TraceSampling
): TelemetryTracingProvider {
  const exporting: SpanProcessor[] =
    config.tracesUrl === undefined
      ? []
      : [
          new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: config.tracesUrl,
              headers: config.tracesHeaders,
            })
          ),
        ];
  const provider = new BasicTracerProvider({
    resource,
    sampler: sampling,
    spanProcessors: [
      {
        onStart: (span, parentContext) => {
          if (userIdSuppressed(parentContext)) return;
          const userId = getUserId();
          if (userId !== undefined) span.setAttribute(ATTR_USER_ID, userId);
        },
        onEnd: () => {},
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
      ...exporting.map(
        (processor): SpanProcessor => ({
          onStart: (span, parent) => processor.onStart(span, parent),
          onEnd: (span) => {
            const exported = sampling.exported(span);
            if (exported) processor.onEnd(exported);
          },
          forceFlush: () => processor.forceFlush(),
          shutdown: () => processor.shutdown(),
        })
      ),
    ],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();
  // BasicTracerProvider has no register(): install it as the global API's,
  // which `Telemetry.span` resolves its tracer through.
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  return {
    getTracer: (...args) => provider.getTracer(...args),
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
