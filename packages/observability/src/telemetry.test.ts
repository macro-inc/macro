// @vitest-environment jsdom
import { context, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, test } from "vitest";
import { Telemetry } from "./index";
import { userIdSuppressed } from "./privacy";
import { ZoneContextManager } from "./zone";

context.setGlobalContextManager(new ZoneContextManager().enable());

const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
	new BasicTracerProvider({
		spanProcessors: [
			{
				onStart: (span, parentContext) => {
					if (!userIdSuppressed(parentContext)) {
						span.setAttribute("usr.id", "test-user");
					}
				},
				onEnd: () => {},
				forceFlush: () => Promise.resolve(),
				shutdown: () => Promise.resolve(),
			},
			new SimpleSpanProcessor(spanExporter),
		],
	}),
);

const logExporter = new InMemoryLogRecordExporter();
logs.setGlobalLoggerProvider(
	new LoggerProvider({
		processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
	}),
);

describe("Telemetry", () => {
	beforeEach(() => {
		spanExporter.reset();
		logExporter.reset();
	});

	test("awaits the async enablement decision", async () => {
		let decide!: (enabled: boolean) => void;
		let markDecisionRequested!: () => void;
		const decisionRequested = new Promise<void>((resolve) => {
			markDecisionRequested = resolve;
		});
		let initialized = false;
		const initialization = Telemetry.init({
			serviceName: "web-app",
			environment: "test",
			enabled: () =>
				new Promise<boolean>((resolve) => {
					decide = resolve;
					markDecisionRequested();
				}),
		}).then(() => {
			initialized = true;
		});

		await decisionRequested;
		expect(initialized).toBe(false);

		decide(false);
		await initialization;
		expect(initialized).toBe(true);
	});

	test("a span exports only when ended", () => {
		const span = Telemetry.span("doc.open");
		span.setAttr("document.id", "abc");
		expect(spanExporter.getFinishedSpans()).toHaveLength(0);

		span.end();
		span.end();

		expect(spanExporter.getFinishedSpans()).toHaveLength(1);
		expect(spanExporter.getFinishedSpans()[0]?.attributes).toMatchObject({
			"document.id": "abc",
		});
	});

	test("anonymous span trees are detached roots and suppress identity", () => {
		const regular = Telemetry.span("regular");
		const anonymous = regular.run(() =>
			Telemetry.anonymousSpan("cache.request"),
		);
		const child = anonymous.span("cache.storage");
		child.end();
		anonymous.end();
		regular.end();

		const spans = new Map(
			spanExporter.getFinishedSpans().map((span) => [span.name, span]),
		);
		expect(spans.get("regular")?.attributes["usr.id"]).toBe("test-user");
		expect(spans.get("cache.request")?.attributes).not.toHaveProperty("usr.id");
		expect(spans.get("cache.request")?.parentSpanContext).toBeUndefined();
		expect(spans.get("cache.storage")?.attributes).not.toHaveProperty("usr.id");
	});

	test("ends a callback span after the async operation", async () => {
		let complete: () => void = () => {};
		const operation = Telemetry.span("doc.save", async (span) => {
			span.setAttr("document.id", "abc");
			await new Promise<void>((resolve) => {
				complete = resolve;
			});
			return 42;
		});

		await Promise.resolve();
		expect(spanExporter.getFinishedSpans()).toHaveLength(0);
		complete();
		expect(await operation).toBe(42);
		expect(spanExporter.getFinishedSpans()).toHaveLength(1);
	});

	test("ends a callback span when the async operation throws", async () => {
		const failure = new Error("failed");

		await expect(
			Telemetry.span("doc.save", async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(spanExporter.getFinishedSpans()).toHaveLength(1);
	});

	test("starts children from the parent span context", () => {
		const root = Telemetry.span("doc.open");
		const child = root.span("doc.load");
		child.end();
		root.end();

		const spans = new Map(
			spanExporter.getFinishedSpans().map((span) => [span.name, span]),
		);
		expect(spans.get("doc.load")?.parentSpanContext?.spanId).toBe(
			spans.get("doc.open")?.spanContext().spanId,
		);
	});

	test("ends a callback child span after the async operation", async () => {
		const root = Telemetry.span("doc.open");
		let complete: () => void = () => {};
		const operation = root.span("doc.snapshot.dss-cache", async (span) => {
			span.setAttr("snapshot.source", "dss");
			await new Promise<void>((resolve) => {
				complete = resolve;
			});
			return "unavailable";
		});

		await Promise.resolve();
		expect(spanExporter.getFinishedSpans()).toHaveLength(0);
		complete();
		expect(await operation).toBe("unavailable");
		root.end();

		const spans = new Map(
			spanExporter.getFinishedSpans().map((span) => [span.name, span]),
		);
		expect(spans.get("doc.snapshot.dss-cache")?.attributes).toMatchObject({
			"snapshot.source": "dss",
		});
		expect(spans.get("doc.snapshot.dss-cache")?.parentSpanContext?.spanId).toBe(
			spans.get("doc.open")?.spanContext().spanId,
		);
	});

	test("run makes the span active", () => {
		const root = Telemetry.span("doc.open");
		const child = root.run(() => Telemetry.span("http request"));
		child.end();
		root.end();

		const spans = new Map(
			spanExporter.getFinishedSpans().map((span) => [span.name, span]),
		);
		expect(spans.get("http request")?.parentSpanContext?.spanId).toBe(
			spans.get("doc.open")?.spanContext().spanId,
		);
	});

	test("records span errors", () => {
		const span = Telemetry.span("doc.open");
		span.error(new Error("boom"));
		span.end();

		const [exported] = spanExporter.getFinishedSpans();
		expect(exported?.status.code).not.toBe(0);
		expect(exported?.events[0]?.name).toBe("exception");
	});

	test("emits structured logs", () => {
		Telemetry.warn("WAL flush not acked", {
			"document.id": "doc-1",
			dirty: 3,
		});

		const [record] = logExporter.getFinishedLogRecords();
		expect(record?.severityText).toBe("warn");
		expect(record?.body).toBe("WAL flush not acked");
		expect(record?.attributes).toMatchObject({
			"document.id": "doc-1",
			dirty: 3,
		});
	});
});
