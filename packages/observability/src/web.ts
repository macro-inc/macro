import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Resource } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
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
import { createPerfSampler } from './sampler';
import { StartupSampler } from './startup-sampler';

/** Creates the browser OpenTelemetry provider used by the web application. */
export function createWebTracingProvider(
  config: TelemetryInitConfig,
  resource: Resource,
  getUserId: () => string | undefined,
  perfSampled: boolean
): TelemetryTracingProvider {
  const sampling = config.startup
    ? new StartupSampler(perfSampled, config.startup)
    : undefined;
  const createExporter = async (): Promise<SpanProcessor> => {
    const settings = config.startup ? await config.startup : config;
    await sampling?.ready;
    if (!settings.tracesUrl) return new NoopSpanProcessor();
    const processor = new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: settings.tracesUrl,
        fetch: config.exportFetch,
      }),
      // Native recordings can replay up to 3600 samples after a pause.
      settings.recording ? { maxQueueSize: 8192 } : undefined
    );
    if (!sampling) return processor;
    return {
      onStart: (span, parent) => processor.onStart(span, parent),
      onEnd: (span) => {
        if (sampling.exports(span)) processor.onEnd(span);
      },
      forceFlush: () => processor.forceFlush(),
      shutdown: () => processor.shutdown(),
    };
  };
  const provider = new WebTracerProvider({
    resource,
    sampler:
      sampling ??
      (config.recording
        ? new AlwaysOnSampler()
        : createPerfSampler(perfSampled)),
    spanProcessors: [
      {
        onStart: (span, parentContext) => {
          sampling?.remember(span, parentContext);
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
    ...(sampling && {
      resolveSpanContext: (span) => sampling.spanContext(span),
    }),
  };
}

export { StackContextManager } from '@opentelemetry/sdk-trace-web';
