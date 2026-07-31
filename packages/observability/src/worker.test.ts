import type { Span } from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";
import { createWorkerTraceConfig, type TraceConfig } from "./worker";

function fakeSpan(): { span: Span; attributes: Record<string, unknown> } {
	const attributes: Record<string, unknown> = {};
	const span = {
		setAttribute(name: string, value: unknown) {
			attributes[name] = value;
			return span;
		},
	} as unknown as Span;
	return { span, attributes };
}

function spanProcessors(config: TraceConfig): SpanProcessor[] {
	// isSpanProcessorConfig is d.ts-only in the rc bundle; narrow structurally.
	if (!("spanProcessors" in config)) throw new Error("expected processors");
	return Array.isArray(config.spanProcessors)
		? config.spanProcessors
		: [config.spanProcessors];
}

describe("createWorkerTraceConfig", () => {
	test("stamps environment and user id onto started spans", () => {
		const config = createWorkerTraceConfig({
			serviceName: "test-worker",
			environment: "test",
			getUserId: () => "user-1",
		});

		const { span, attributes } = fakeSpan();
		spanProcessors(config)[0]?.onStart(
			span as Parameters<SpanProcessor["onStart"]>[0],
			undefined as unknown as Parameters<SpanProcessor["onStart"]>[1],
		);

		expect(attributes).toEqual({
			"deployment.environment": "test",
			"usr.id": "user-1",
		});
	});

	test("omits the user id attribute when there is no user", () => {
		const config = createWorkerTraceConfig({
			serviceName: "test-worker",
			environment: "test",
		});

		const { span, attributes } = fakeSpan();
		spanProcessors(config)[0]?.onStart(
			span as Parameters<SpanProcessor["onStart"]>[0],
			undefined as unknown as Parameters<SpanProcessor["onStart"]>[1],
		);

		expect(attributes).toEqual({ "deployment.environment": "test" });
	});

	test("adds an export processor only when tracesUrl is set", () => {
		const withoutUrl = createWorkerTraceConfig({
			serviceName: "test-worker",
			environment: "test",
		});
		expect(spanProcessors(withoutUrl)).toHaveLength(1);

		const withUrl = createWorkerTraceConfig({
			serviceName: "test-worker",
			environment: "test",
			tracesUrl: "http://localhost:4318/v1/traces",
		});
		expect(spanProcessors(withUrl)).toHaveLength(2);
	});
});
