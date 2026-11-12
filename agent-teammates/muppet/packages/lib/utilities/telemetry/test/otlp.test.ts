import { describe, expect, test } from "bun:test";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { attributes, otlpSink } from "../otlp.ts";
import type { Ended, WakeRecord } from "../record.ts";

const ended: Ended = {
	v: 1,
	phase: "end",
	system: "pr-factory",
	wake: "wake-1",
	trace: {
		traceId: "cd".repeat(16),
		spanId: "ab".repeat(8),
		parentSpanId: "ef".repeat(8),
	},
	parent: { wake: "wake-0", system: "tod" },
	trigger: {
		kind: "schedule",
		source: "schedules",
		name: "ci-pass",
		ids: { pr: "macro-inc/macro#10357" },
		summary: "CI failed on #10357",
	},
	startedAt: "2026-11-11T09:00:00.000Z",
	terminal: "t1h7",
	session: {
		id: "sess-1",
		agent: "claude",
		provider: "anthropic",
		model: "claude-haiku-5-5",
	},
	endedAt: "2026-11-11T09:01:30.500Z",
	durationMs: 90_500,
	status: "failed",
	error: { type: "error_max_budget_usd", message: "out of budget" },
	outcome: {
		name: "rerun_flake",
		source: "reported",
		check: "confirmed",
		reported: "rerun_flake",
		observed: "rerun_flake",
		summary: "reran the flaky job",
	},
	effects: [{ kind: "ci_rerun", id: "991" }],
	usage: { costUsd: 0.25, turns: 7, inputTokens: 1200, outputTokens: 300 },
};

const resource = { system: "pr-factory", attributes: { "host.name": "bp" } };

describe("attributes", () => {
	test("a wake as OpenTelemetry attributes: GenAI's where they fit, muppet's for the rest", () => {
		expect(attributes(ended)).toEqual({
			"event.name": "muppet.wake.end",
			"muppet.schema": 1,
			"muppet.system": "pr-factory",
			"muppet.wake.id": "wake-1",
			"muppet.wake.phase": "end",
			"muppet.wake.parent.id": "wake-0",
			"muppet.wake.parent.system": "tod",
			"muppet.wake.started_at": "2026-11-11T09:00:00.000Z",
			"muppet.trigger.kind": "schedule",
			"muppet.trigger.source": "schedules",
			"muppet.trigger.name": "ci-pass",
			"muppet.trigger.summary": "CI failed on #10357",
			"muppet.trigger.id.pr": "macro-inc/macro#10357",
			"muppet.herdr.terminal": "t1h7",
			"gen_ai.operation.name": "invoke_agent",
			"gen_ai.agent.name": "pr-factory",
			"gen_ai.conversation.id": "sess-1",
			"session.id": "sess-1",
			"gen_ai.provider.name": "anthropic",
			"gen_ai.request.model": "claude-haiku-5-5",
			"muppet.agent.kind": "claude",
			"muppet.wake.ended_at": "2026-11-11T09:01:30.500Z",
			"muppet.wake.duration_ms": 90_500,
			"muppet.wake.status": "failed",
			"error.type": "error_max_budget_usd",
			"error.message": "out of budget",
			"muppet.outcome.name": "rerun_flake",
			"muppet.outcome.source": "reported",
			"muppet.outcome.check": "confirmed",
			"muppet.outcome.reported": "rerun_flake",
			"muppet.outcome.observed": "rerun_flake",
			"muppet.outcome.summary": "reran the flaky job",
			"muppet.effects": ["ci_rerun:991"],
			"gen_ai.usage.input_tokens": 1200,
			"gen_ai.usage.output_tokens": 300,
			"muppet.usage.cost_usd": 0.25,
			"muppet.usage.turns": 7,
		});
	});
});

const started: WakeRecord = {
	v: 1,
	phase: "start",
	system: "pr-factory",
	wake: "wake-1",
	trace: { traceId: "cd".repeat(16), spanId: "ab".repeat(8) },
	trigger: { kind: "manual", source: "cli", ids: {} },
	startedAt: "2026-11-11T09:00:00.000Z",
};

describe("otlpSink", () => {
	const memory = () => {
		const logs = new InMemoryLogRecordExporter();
		const spans = new InMemorySpanExporter();
		const otlp = otlpSink({
			endpoint: "http://unused",
			resource,
			exporters: { logs, spans },
		});
		return { otlp, logs, spans };
	};

	test("a record is one log record, in its trace, an error when the wake failed", async () => {
		const { otlp, logs } = memory();
		await otlp.sink(started);
		await otlp.sink(ended);
		await otlp.flush();
		const [first, last] = logs.getFinishedLogRecords();
		expect(first?.eventName).toBe("muppet.wake.start");
		expect(first?.severityText).toBe("INFO");
		expect(first?.hrTime).toEqual([1794387600, 0]);
		expect(last?.eventName).toBe("muppet.wake.end");
		expect(last?.severityText).toBe("ERROR");
		expect(last?.severityNumber).toBe(17);
		expect(last?.hrTime).toEqual([1794387690, 500_000_000]);
		expect(last?.body).toBe(
			"pr-factory wake wake-1 failed: rerun_flake (schedule schedules ci-pass)",
		);
		expect(last?.spanContext?.traceId).toBe("cd".repeat(16));
		expect(last?.spanContext?.spanId).toBe("ab".repeat(8));
		expect(last?.attributes).toEqual({
			...attributes(ended),
			"muppet.effects": ["ci_rerun:991"],
		});
		expect(last?.resource.attributes).toMatchObject({
			"service.name": "pr-factory",
			"service.namespace": "muppet",
			"host.name": "bp",
		});
		expect(last?.instrumentationScope.name).toBe("muppet.telemetry");
	});

	test("an ended wake is one invoke_agent span with the record's own ids, under its parent", async () => {
		const { otlp, spans } = memory();
		await otlp.sink(started);
		await otlp.sink(ended);
		await otlp.sink({
			...ended,
			wake: "wake-2",
			operation: "invoke_workflow",
			status: "ok",
			trace: { traceId: "12".repeat(16), spanId: "34".repeat(8) },
		});
		await otlp.flush();
		const [span, root, ...others] = spans.getFinishedSpans();
		expect(others).toEqual([]);
		expect(span?.name).toBe("invoke_agent pr-factory");
		expect(span?.kind).toBe(0);
		expect(span?.spanContext().traceId).toBe("cd".repeat(16));
		expect(span?.spanContext().spanId).toBe("ab".repeat(8));
		expect(span?.parentSpanContext?.spanId).toBe("ef".repeat(8));
		expect(span?.startTime).toEqual([1794387600, 0]);
		expect(span?.endTime).toEqual([1794387690, 500_000_000]);
		expect(span?.status).toEqual({ code: 2, message: "out of budget" });
		expect(span?.attributes["muppet.outcome.name"]).toBe("rerun_flake");
		expect(root?.name).toBe("invoke_workflow pr-factory");
		expect(root?.spanContext().traceId).toBe("12".repeat(16));
		expect(root?.spanContext().spanId).toBe("34".repeat(8));
		expect(root?.parentSpanContext).toBeUndefined();
		expect(root?.status.code).toBe(1);
	});

	test("sends OTLP over HTTP to the collector's logs and traces paths", async () => {
		const posts: string[] = [];
		const collector = Bun.serve({
			port: 0,
			fetch: async (request) => {
				posts.push(
					`${new URL(request.url).pathname} ${request.headers.get("content-type")} ${(await request.arrayBuffer()).byteLength > 0}`,
				);
				return new Response("{}", {
					headers: { "content-type": "application/json" },
				});
			},
		});
		try {
			const otlp = otlpSink({
				endpoint: `http://127.0.0.1:${collector.port}`,
				resource,
			});
			await otlp.sink(ended);
			await otlp.flush();
			expect(posts.sort()).toEqual([
				"/v1/logs application/json true",
				"/v1/traces application/json true",
			]);
		} finally {
			await collector.stop(true);
		}
	});

	test("with the collector down, never throws and never waits on it", async () => {
		const otlp = otlpSink({
			// Nothing listens on the discard port.
			endpoint: "http://127.0.0.1:9",
			resource,
			timeoutMs: 200,
		});
		const before = performance.now();
		await otlp.sink(started);
		await otlp.sink(ended);
		expect(performance.now() - before).toBeLessThan(50);
		await otlp.flush();
	});
});
