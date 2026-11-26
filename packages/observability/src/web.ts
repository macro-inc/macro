import { createContextKey, ROOT_CONTEXT } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  type Resource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NoopSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { TelemetryInitConfig } from './config';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_USER_ID,
  INSTRUMENTATION_SCOPE_NAME,
} from './constants';
import { DeferredSpanProcessor } from './deferred-span-processor';
import { userIdSuppressed } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import type { TraceSampling } from './sampling';

const ANONYMOUS_SAMPLE = createContextKey('macro.anonymous_sample');

/** Creates the browser OpenTelemetry provider used by the web application. */
export function createWebTracingProvider(
  config: TelemetryInitConfig<string>,
  resource: Resource,
  getUserId: () => string | undefined,
  sampling: TraceSampling
): TelemetryTracingProvider {
  const anonymousSamples = new WeakSet<ReadableSpan>();
  const anonymousResource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment,
    [ATTR_SERVICE_VERSION]: config.resourceAttributes?.[ATTR_SERVICE_VERSION],
    'app.runtime': config.resourceAttributes?.['app.runtime'],
  });
  const createExporter = async (): Promise<SpanProcessor> => {
    const settings = config.startup ? await config.startup : config;
    // Buffered spans are placed by the classes decided at enablement.
    await sampling.decided;
    if (!settings.tracesUrl) return new NoopSpanProcessor();
    const tracesUrl = settings.tracesUrl;
    const processor = new BatchSpanProcessor(
      new OTLPTraceExporter({ url: tracesUrl, fetch: config.exportFetch }),
      // Native recordings can replay up to 3600 samples after a pause.
      settings.recording ? { maxQueueSize: 8192 } : undefined
    );
    // A shared OTLP request could associate an anonymous sample with an
    // identifying resource elsewhere in the same batch.
    let anonymousProcessor: BatchSpanProcessor | undefined;
    return {
      onStart: (span, parent) => {
        if (!anonymousSamples.has(span)) processor.onStart(span, parent);
      },
      onEnd: (span) => {
        if (anonymousSamples.has(span)) {
          anonymousProcessor ??= new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: tracesUrl,
              fetch: (input, init) => {
                const options: RequestInit = {
                  ...init,
                  credentials: 'omit',
                  referrerPolicy: 'no-referrer',
                };
                if (config.exportFetch)
                  return config.exportFetch(input, options);
                return globalThis.fetch(input, options);
              },
            })
          );
          anonymousProcessor.onEnd({
            name: span.name,
            kind: span.kind,
            spanContext: () => span.spanContext(),
            startTime: span.startTime,
            endTime: span.endTime,
            status: span.status,
            attributes: span.attributes,
            links: [],
            events: [],
            duration: span.duration,
            ended: span.ended,
            resource: anonymousResource,
            instrumentationScope: span.instrumentationScope,
            droppedAttributesCount: span.droppedAttributesCount,
            droppedEventsCount: 0,
            droppedLinksCount: 0,
          });
        } else {
          const exported = sampling.exported(span);
          if (exported) processor.onEnd(exported);
        }
      },
      async forceFlush() {
        await Promise.all([
          processor.forceFlush(),
          anonymousProcessor?.forceFlush().catch(() => {}),
        ]);
      },
      async shutdown() {
        await Promise.all([
          processor.shutdown(),
          anonymousProcessor?.shutdown().catch(() => {}),
        ]);
      },
    };
  };
  const exporter =
    config.tracesUrl || config.startup
      ? new DeferredSpanProcessor(config.enabled(), createExporter)
      : undefined;
  const provider = new WebTracerProvider({
    resource,
    sampler: sampling,
    spanProcessors: [
      {
        onStart: (span, parentContext) => {
          if (parentContext.getValue(ANONYMOUS_SAMPLE) === true) {
            anonymousSamples.add(span);
            return;
          }
          span.setAttributes(config.spanAttributes?.() ?? {});
          if (userIdSuppressed(parentContext)) return;
          const userId = getUserId();
          if (userId !== undefined) span.setAttribute(ATTR_USER_ID, userId);
        },
        onEnding: (span) => {
          if (anonymousSamples.has(span)) return;
          const attributes = config.spanAttributes?.() ?? {};
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined) span.setAttribute(`${key}.end`, value);
          }
        },
        onEnd: () => {},
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
      ...(exporter ? [exporter] : []),
    ],
  });
  provider.register({
    ...(config.contextManager && { contextManager: config.contextManager }),
    propagator: new W3CTraceContextPropagator(),
  });
  return {
    getTracer: (...args) => provider.getTracer(...args),
    recordAnonymousSample(name, attributes) {
      // Regular startup traces own the deferred buffer.
      if (!exporter?.isReady) return;
      const timestamp = Date.now();
      provider
        .getTracer(INSTRUMENTATION_SCOPE_NAME)
        .startSpan(
          name,
          { attributes, startTime: timestamp },
          ROOT_CONTEXT.setValue(ANONYMOUS_SAMPLE, true)
        )
        .end(timestamp);
    },
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}

export { StackContextManager } from '@opentelemetry/sdk-trace-web';
