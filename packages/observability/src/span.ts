import {
	type Context,
	context,
	isSpanContextValid,
	type Attributes as OtelAttributes,
	propagation,
	type Span as OtelSpan,
	SpanStatusCode,
} from "@opentelemetry/api";
import type { Attribute, Attributes } from "./config";

/** A manually managed span. Calling {@link Span.end} ends it. */
export interface Span {
	/** Start a child span, or run and end one around an async operation. */
	span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
	span(name: string): Span;
	/** Run with this span as the active OpenTelemetry context. */
	run<T>(operation: () => T): T;
	/** Set one span attribute. */
	setAttr(name: string, value: Attribute): void;
	/** Add a point-in-time event. */
	event(name: string, attributes?: Attributes): void;
	/** Record an exception and mark the span as failed. */
	error(error: unknown): void;
	/** Return this span's W3C trace context for transports without headers. */
	traceparent(): string | undefined;
	/** Inject this span's W3C trace context into an HTTP header carrier. */
	injectTraceHeaders(headers: Record<string, string>): void;
	/** End the span. Safe to call more than once. */
	end(): void;
}

export class SpanImpl implements Span {
	#ended = false;

	constructor(
		private readonly otelSpan: OtelSpan,
		private readonly ctx: Context,
		private readonly startChild: (name: string, parent: Context) => Span,
	) {}

	span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
	span(name: string): Span;
	span<T>(
		name: string,
		operation?: (span: Span) => Promise<T>,
	): Span | Promise<T> {
		const span = this.startChild(name, this.ctx);
		if (!operation) return span;

		return span.run(async () => {
			try {
				return await operation(span);
			} finally {
				span.end();
			}
		});
	}

	run<T>(operation: () => T): T {
		return context.with(this.ctx, operation);
	}

	setAttr(name: string, value: Attribute): void {
		if (!this.#ended) this.otelSpan.setAttribute(name, value);
	}

	event(name: string, attributes?: Attributes): void {
		if (!this.#ended)
			this.otelSpan.addEvent(name, attributes as OtelAttributes);
	}

	error(error: unknown): void {
		if (this.#ended) return;
		const exception = SpanImpl.normalizeError(error);
		this.otelSpan.recordException(exception);
		this.otelSpan.setStatus({
			code: SpanStatusCode.ERROR,
			message:
				typeof exception === "string" ? exception : (exception.message ?? ""),
		});
	}

	traceparent(): string | undefined {
		const spanContext = this.otelSpan.spanContext();
		if (!isSpanContextValid(spanContext)) return undefined;
		const { traceId, spanId, traceFlags } = spanContext;
		return `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, "0")}`;
	}

	injectTraceHeaders(headers: Record<string, string>): void {
		if (!this.#ended) propagation.inject(this.ctx, headers);
	}

	end(): void {
		if (this.#ended) return;
		this.#ended = true;
		this.otelSpan.end();
	}

	private static normalizeError(error: unknown): Error | string {
		return error instanceof Error ||
			typeof error === "string" ||
			(typeof error === "object" && error !== null && "message" in error)
			? (error as Error | string)
			: String(error);
	}
}
