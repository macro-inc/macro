import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Resource } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NoopSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import type { TelemetryInitConfig } from './config';
import { ATTR_USER_ID } from './constants';
import { DeferredSpanProcessor } from './deferred-span-processor';
import { userIdSuppressed } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import type { TraceSampling } from './sampling';

/** Creates the browser OpenTelemetry provider used by the web application. */
export function createWebTracingProvider(
  config: TelemetryInitConfig<string>,
  resource: Resource,
  getUserId: () => string | undefined,
  sampling: TraceSampling
): TelemetryTracingProvider {
  const createExporter = async (): Promise<SpanProcessor> => {
    const settings = config.startup ? await config.startup : config;
    // Buffered spans are placed by the classes decided at enablement.
    await sampling.decided;
    if (!settings.tracesUrl) return new NoopSpanProcessor();
    const processor = new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: settings.tracesUrl,
        fetch: config.exportFetch,
      }),
      // Native recordings can replay up to 3600 samples after a pause.
      settings.recording ? { maxQueueSize: 8192 } : undefined
    );
    return {
      onStart: (span, parent) => processor.onStart(span, parent),
      onEnd: (span) => {
        const exported = sampling.exported(span);
        if (exported) processor.onEnd(exported);
      },
      forceFlush: () => processor.forceFlush(),
      shutdown: () => processor.shutdown(),
    };
  };
  const provider = new WebTracerProvider({
    resource,
    sampler: sampling,
    spanProcessors: [
      {
        onStart: (span, parentContext) => {
          span.setAttributes(config.spanAttributes?.() ?? {});
          if (userIdSuppressed(parentContext)) return;
          const userId = getUserId();
          if (userId !== undefined) span.setAttribute(ATTR_USER_ID, userId);
        },
        onEnding: (span) => {
          const attributes = config.spanAttributes?.() ?? {};
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined) span.setAttribute(`${key}.end`, value);
          }
        },
        onEnd: () => {},
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
      ...(config.tracesUrl || config.startup
        ? [new DeferredSpanProcessor(config.enabled(), createExporter)]
        : []),
    ],
  });
  provider.register({
    ...(config.contextManager && { contextManager: config.contextManager }),
    propagator: new W3CTraceContextPropagator(),
  });
  return {
    getTracer: (...args) => provider.getTracer(...args),
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}

export { StackContextManager } from '@opentelemetry/sdk-trace-web';
