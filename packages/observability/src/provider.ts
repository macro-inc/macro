import type { TracerProvider } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";

/** A runtime-specific OpenTelemetry tracer provider. */
export type TelemetryTracingProvider = TracerProvider & {
	forceFlush(): Promise<void>;
	shutdown(): Promise<void>;
};

/** Creates a tracer provider after telemetry has been enabled. */
export type TelemetryTracingProviderFactory = (
	resource: Resource,
	getUserId: () => string | undefined,
) => TelemetryTracingProvider;
