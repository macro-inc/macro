import { type Context, context, SpanKind, trace } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import type { TelemetryInitConfig } from "./config";
import { INSTRUMENTATION_SCOPE_NAME } from "./constants";
import type { TelemetryTracingProvider } from "./provider";
import { type Span, SpanImpl } from "./span";

export class Tracing {
	#provider: TelemetryTracingProvider | undefined;

	init(
		config: TelemetryInitConfig,
		resource: Resource,
		getUserId: () => string | undefined,
	): void {
		this.#provider = config.tracingProvider?.(resource, getUserId);
	}

	span(name: string): Span {
		return this.#startSpan(name, context.active());
	}

	clientSpan(name: string): Span {
		return this.#startSpan(name, context.active(), SpanKind.CLIENT);
	}

	async flush(): Promise<void> {
		await this.#provider?.forceFlush();
	}

	async shutdown(): Promise<void> {
		await this.#provider?.shutdown();
		this.#provider = undefined;
	}

	#startSpan(name: string, parent: Context, kind?: SpanKind): Span {
		const otelSpan = trace
			.getTracer(INSTRUMENTATION_SCOPE_NAME)
			.startSpan(name, kind === undefined ? undefined : { kind }, parent);
		return new SpanImpl(
			otelSpan,
			trace.setSpan(parent, otelSpan),
			(childName, childParent) => this.#startSpan(childName, childParent),
		);
	}
}
