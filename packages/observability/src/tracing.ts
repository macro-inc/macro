import { type Context, context, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { TelemetryInitConfig } from "./config";
import { ATTR_USER_ID, INSTRUMENTATION_SCOPE_NAME } from "./constants";
import { type Span, SpanImpl } from "./span";

export class Tracing {
	#provider: WebTracerProvider | undefined;

	init(
		config: TelemetryInitConfig,
		resource: Resource,
		getUserId: () => string | undefined,
	): void {
		this.#provider = new WebTracerProvider({
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
		this.#provider.register({
			...(config.contextManager && { contextManager: config.contextManager }),
			propagator: new W3CTraceContextPropagator(),
		});
	}

	span(name: string): Span {
		return this.#startSpan(name, context.active());
	}

	async flush(): Promise<void> {
		await this.#provider?.forceFlush();
	}

	async shutdown(): Promise<void> {
		await this.#provider?.shutdown();
		this.#provider = undefined;
	}

	#startSpan(name: string, parent: Context): Span {
		const otelSpan = trace
			.getTracer(INSTRUMENTATION_SCOPE_NAME)
			.startSpan(name, undefined, parent);
		return new SpanImpl(
			otelSpan,
			trace.setSpan(parent, otelSpan),
			(childName, childParent) => this.#startSpan(childName, childParent),
		);
	}
}
