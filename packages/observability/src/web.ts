import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Resource } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import type { TelemetryInitConfig } from './config';
import { ATTR_USER_ID } from './constants';
import { userIdSuppressed } from './privacy';
import type { TelemetryTracingProvider } from './provider';

/** Creates the browser OpenTelemetry provider used by the web application. */
export function createWebTracingProvider(
  config: TelemetryInitConfig,
  resource: Resource,
  getUserId: () => string | undefined
): TelemetryTracingProvider {
  const provider = new WebTracerProvider({
    resource,
    ...(config.recording && { sampler: new AlwaysOnSampler() }),
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
      ...(config.tracesUrl
        ? [
            new BatchSpanProcessor(
              new OTLPTraceExporter({ url: config.tracesUrl }),
              // The native recorder can replay up to 3600 samples after a pause.
              config.recording ? { maxQueueSize: 8192 } : undefined
            ),
          ]
        : []),
    ],
  });
  provider.register({
    ...(config.contextManager && { contextManager: config.contextManager }),
    propagator: new W3CTraceContextPropagator(),
  });
  return provider;
}
