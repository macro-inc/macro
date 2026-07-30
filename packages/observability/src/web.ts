import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { TelemetryInitConfig } from "./config";
import { ATTR_USER_ID } from "./constants";
import type { TelemetryTracingProvider } from "./provider";

/** Creates the browser OpenTelemetry provider used by the web application. */
export function createWebTracingProvider(
	config: TelemetryInitConfig,
	resource: Resource,
	getUserId: () => string | undefined,
): TelemetryTracingProvider {
	const provider = new WebTracerProvider({
		resource,
		spanProcessors: [
			{
				onStart: (span) => {
					const userId = getUserId();
					if (userId !== undefined) span.setAttribute(ATTR_USER_ID, userId);
				},
				onEnd: () => {},
				forceFlush: () => Promise.resolve(),
				shutdown: () => Promise.resolve(),
			},
			...(config.tracesUrl
				? [
						new BatchSpanProcessor(
							new OTLPTraceExporter({ url: config.tracesUrl }),
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
