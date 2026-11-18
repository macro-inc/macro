import { describe, expect, test } from "bun:test";
import { attributes } from "../attributes.ts";
import {
	defineOutcomes,
	type MacroSpan,
	type MacroTelemetry,
	macroTelemetry,
	wakeTelemetry,
} from "../index.ts";
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

/** Stands in for `Telemetry` of @macro-inc/observability, and writes down what it is asked to do. */
const fake = () => {
	const calls: string[] = [];
	const active: string[] = [];
	let spans = 0;
	const within = <T>(context: string, operation: () => T): T => {
		active.push(context);
		try {
			return operation();
		} finally {
			active.pop();
		}
	};
	const context = (): string => active.at(-1) ?? "none";
	const remote = "remote 00-";
	const span = (name: string, startTime: number | undefined): MacroSpan => {
		const id = String(++spans).padStart(16, "0");
		const parent = context();
		const traceId = parent.startsWith(remote)
			? parent.slice(remote.length, remote.length + 32)
			: "aa".repeat(16);
		calls.push(`span ${name} at ${startTime} in ${parent}`);
		return {
			run: (operation) => within(`span ${id}`, operation),
			setAttr: (key, value) => {
				calls.push(`attr ${id} ${key}=${JSON.stringify(value)}`);
			},
			error: (error) => {
				calls.push(`error ${id} ${String(error)}`);
			},
			traceparent: () => `00-${traceId}-${id}-01`,
			end: (timestamp) => {
				calls.push(`end ${id} at ${timestamp}`);
			},
		};
	};
	const log =
		(level: string) =>
		(message: unknown, details?: Readonly<Record<string, unknown>>): void => {
			calls.push(
				`${level} in ${context()}: ${String(message)} [${details?.["event.name"]}]`,
			);
		};
	const telemetry: MacroTelemetry = {
		span: (name, options) => span(name, options?.startTime),
		remoteContext: (traceparent) => ({
			run: (operation) => within(`remote ${traceparent}`, operation),
		}),
		info: log("info"),
		warn: log("warn"),
		error: log("error"),
		flush: async () => {
			calls.push("flush");
		},
	};
	return { telemetry, calls };
};

describe("macroTelemetry", () => {
	test("a wake is a span of the framework, which gives the record its ids, and each record a log inside it", async () => {
		const { telemetry, calls } = fake();
		const macro = macroTelemetry({ telemetry });
		const records: WakeRecord[] = [];
		let now = Temporal.Instant.from("2026-11-11T09:00:00Z");
		const wakes = wakeTelemetry({
			system: "pr-factory",
			outcomes: defineOutcomes<"ci_rerun">()({
				rerun_flake: { description: "Reran it.", evidence: ["ci_rerun"] },
			}),
			sinks: [
				macro.sink,
				async (record) => {
					records.push(record);
				},
			],
			spans: macro.spans,
			clock: { now: () => now },
			id: () => "wake-1",
			hex: (bytes) => "ff".repeat(bytes),
		});
		const wake = wakes.begin(
			{ kind: "manual", source: "cli", ids: {} },
			{ parent: { traceId: "cd".repeat(16), spanId: "ef".repeat(8) } },
		);
		expect(wake.env().TRACEPARENT).toBe(
			`00-${"cd".repeat(16)}-0000000000000001-01`,
		);
		now = now.add({ milliseconds: 90_500 });
		const ended = await wake.end({
			status: "timeout",
			error: { type: "timeout", message: "timed out" },
		});
		await macro.flush();

		expect(ended.trace).toEqual({
			traceId: "cd".repeat(16),
			spanId: "0000000000000001",
			parentSpanId: "ef".repeat(8),
		});
		expect(records.map((record) => record.trace)).toEqual([
			ended.trace,
			ended.trace,
		]);
		expect(calls.slice(0, 3)).toEqual([
			`span invoke_agent pr-factory at 1794387600000 in remote 00-${"cd".repeat(16)}-${"ef".repeat(8)}-01`,
			"info in span 0000000000000001: pr-factory wake wake-1 start (manual cli) [muppet.wake.start]",
			"error in span 0000000000000001: pr-factory wake wake-1 timeout: unclassified (manual cli) [muppet.wake.end]",
		]);
		expect(calls).toContain(
			'attr 0000000000000001 muppet.outcome.name="unclassified"',
		);
		expect(calls.slice(-3)).toEqual([
			"error 0000000000000001 Error: timed out",
			"end 0000000000000001 at 1794387690500",
			"flush",
		]);
	});

	test("an ended wake's span carries every attribute of its record, and ends clean when the wake was ok", async () => {
		const { telemetry, calls } = fake();
		const macro = macroTelemetry({ telemetry });
		macro.spans({
			wake: "wake-1",
			name: "invoke_agent pr-factory",
			startedAtMs: 1794387600000,
		});
		const ok: Ended = { ...ended, status: "ok" };
		await macro.sink(ok);
		expect(calls[0]).toBe(
			"span invoke_agent pr-factory at 1794387600000 in none",
		);
		expect(calls.filter((call) => call.startsWith("attr "))).toEqual(
			Object.entries(attributes(ok)).map(
				([key, value]) =>
					`attr 0000000000000001 ${key}=${JSON.stringify(value)}`,
			),
		);
		expect(calls.some((call) => call.startsWith("error "))).toBe(false);
		expect(calls.at(-1)).toBe("end 0000000000000001 at 1794387690500");
	});

	test("a record whose span was never opened is still logged, and a framework that throws breaks nothing", async () => {
		const { telemetry, calls } = fake();
		await macroTelemetry({ telemetry }).sink(started);
		expect(calls).toEqual([
			"info in none: pr-factory wake wake-1 start (manual cli) [muppet.wake.start]",
		]);

		const broken = macroTelemetry({
			telemetry: {
				...telemetry,
				span: () => {
					throw new Error("not initialised");
				},
				info: () => {
					throw new Error("not initialised");
				},
				flush: async () => {
					throw new Error("collector down");
				},
			},
		});
		const wakes = wakeTelemetry({
			system: "pr-factory",
			outcomes: defineOutcomes()({ done: { description: "Done." } }),
			sinks: [broken.sink],
			spans: broken.spans,
			clock: { now: () => Temporal.Instant.from("2026-11-11T09:00:00Z") },
			id: () => "wake-2",
			hex: (bytes) => "ff".repeat(bytes),
		});
		const wake = await wakes
			.begin({ kind: "manual", source: "cli", ids: {} })
			.end({ status: "ok" });
		expect(wake.trace).toEqual({
			traceId: "ff".repeat(16),
			spanId: "ff".repeat(8),
		});
		await broken.sink(started);
		await broken.flush();
	});
});
