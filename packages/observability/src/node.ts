// Node and Bun entry: server-side processes such as agent teammates. It
// imports `node:async_hooks`, so it stays out of the browser entry.
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { TelemetryInitConfig } from "./config";
import { ATTR_USER_ID } from "./constants";
import { userIdSuppressed } from "./privacy";
import type { TelemetryTracingProvider } from "./provider";
import type { TraceSampling } from "./sampling";

/**
 * Creates the OpenTelemetry provider for a Node or Bun process, and registers
 * it with an async context manager so a span's context follows its awaits.
 * Spans are exported to `config.tracesUrl`; without one nothing is exported.
 */
export function createNodeTracingProvider(
	config: TelemetryInitConfig<string>,
	resource: Resource,
	getUserId: () => string | undefined,
	sampling: TraceSampling,
): TelemetryTracingProvider {
	const exporter = config.tracesUrl
		? new BatchSpanProcessor(new OTLPTraceExporter({ url: config.tracesUrl }))
		: undefined;
	const provider = new BasicTracerProvider({
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
				onEnd: () => {},
				forceFlush: () => Promise.resolve(),
				shutdown: () => Promise.resolve(),
			},
			...(exporter
				? [
						{
							onStart: () => {},
							onEnd: (span: Parameters<BatchSpanProcessor["onEnd"]>[0]) => {
								const exported = sampling.exported(span);
								if (exported) exporter.onEnd(exported);
							},
							forceFlush: () => exporter.forceFlush(),
							shutdown: () => exporter.shutdown(),
						},
					]
				: []),
		],
	});
	context.setGlobalContextManager(
		config.contextManager ?? new AsyncLocalStorageContextManager().enable(),
	);
	propagation.setGlobalPropagator(new W3CTraceContextPropagator());
	trace.setGlobalTracerProvider(provider);
	return {
		getTracer: (...args) => provider.getTracer(...args),
		forceFlush: () => provider.forceFlush(),
		shutdown: () => provider.shutdown(),
	};
}
