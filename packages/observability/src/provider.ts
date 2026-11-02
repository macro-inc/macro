import type { Span, SpanContext, TracerProvider } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';

/** A runtime-specific OpenTelemetry tracer provider. */
export type TelemetryTracingProvider = TracerProvider & {
  /** Final propagation decision for spans captured before startup settings resolved. */
  resolveSpanContext?(span: Span): SpanContext;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

/** Creates a tracer provider; buffered providers gate exporters on enablement. */
export type TelemetryTracingProviderFactory = (
  resource: Resource,
  getUserId: () => string | undefined,
  /** Normal session sampling decision; providers apply recording overrides. */
  perfSampled: boolean
) => TelemetryTracingProvider;
