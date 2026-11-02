import type { TracerProvider } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { TraceSampling } from './sampling';

/** A runtime-specific OpenTelemetry tracer provider. */
export type TelemetryTracingProvider = TracerProvider & {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

/** Creates a tracer provider; buffered providers gate exporters on enablement. */
export type TelemetryTracingProviderFactory = (
  resource: Resource,
  getUserId: () => string | undefined,
  /** Samples spans and decides, once its classes are decided, which to export. */
  sampling: TraceSampling
) => TelemetryTracingProvider;
