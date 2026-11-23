import { describe, expect, test } from "bun:test";
import type { WakeContext, Woke } from "../../../core/agent.ts";
import { codeMode } from "../../../core/code.ts";
import { scripts } from "../../../runtimes/test/scripts.ts";
import {
	attributes,
	defineOutcomes,
	jsonlSink,
	parentFromEnv,
	type Sink,
	type Trigger,
	WakeRecord,
	wakeTelemetry,
} from "../index.ts";

const outcomes = defineOutcomes<"pr_opened">()({
	fixed_pr_opened: { description: "Opened a PR.", evidence: ["pr_opened"] },
	no_repro: { description: "Could not reproduce it." },
});

const setup = (extra: readonly Sink[] = []) => {
	const records: WakeRecord[] = [];
	let now = Temporal.Instant.from("2026-11-11T09:00:00Z");
	let ids = 0;
	const telemetry = wakeTelemetry({
		system: "desktop-factory",
		outcomes,
		sinks: [
			...extra,
			async (record) => {
				records.push(record);
			},
		],
		clock: { now: () => now },
		id: () => `wake-${++ids}`,
		hex: (bytes) => "ab".repeat(bytes),
		terminal: "t1nb",
	});
	return {
		telemetry,
		records,
		advance: (milliseconds: number) => {
			now = now.add({ milliseconds });
		},
	};
};

const trigger: Trigger = {
	kind: "event",
	source: "reports",
	ids: { report: "MC-4321" },
	summary: "Crash opening a PDF",
};

describe("wakeTelemetry", () => {
	test("records a wake's start, session and end, with what triggered it and what came of it", async () => {
		const { telemetry, records, advance } = setup();
		const wake = telemetry.begin(trigger);
		wake.session({ id: "sess-1", agent: "claude", model: "claude-opus-5-5" });
		advance(90_000);
		wake.effect({ kind: "pr_opened", id: "12", url: "https://x/pull/12" });
		telemetry.report({
			wake: wake.id,
			outcome: "fixed_pr_opened",
			summary: "PR 12",
		});
		wake.usage({ costUsd: 0.5, turns: 9, inputTokens: 100, outputTokens: 20 });
		const ended = await wake.end({ status: "ok" });

		expect(records.map((record) => record.phase)).toEqual([
			"start",
			"session",
			"end",
		]);
		expect(records[0]).toEqual({
			v: 1,
			phase: "start",
			system: "desktop-factory",
			wake: "wake-1",
			trace: { traceId: "ab".repeat(16), spanId: "ab".repeat(8) },
			trigger: { ...trigger },
			startedAt: "2026-11-11T09:00:00.000Z",
			terminal: "t1nb",
		});
		expect(records[2]).toEqual(ended);
		expect(ended).toEqual({
			v: 1,
			phase: "end",
			system: "desktop-factory",
			wake: "wake-1",
			trace: { traceId: "ab".repeat(16), spanId: "ab".repeat(8) },
			trigger: { ...trigger },
			startedAt: "2026-11-11T09:00:00.000Z",
			terminal: "t1nb",
			session: {
				id: "sess-1",
				agent: "claude",
				provider: "anthropic",
				model: "claude-opus-5-5",
			},
			endedAt: "2026-11-11T09:01:30.000Z",
			durationMs: 90_000,
			status: "ok",
			outcome: {
				name: "fixed_pr_opened",
				source: "reported",
				check: "confirmed",
				reported: "fixed_pr_opened",
				observed: "fixed_pr_opened",
				summary: "PR 12",
			},
			effects: [{ kind: "pr_opened", id: "12", url: "https://x/pull/12" }],
			usage: { costUsd: 0.5, turns: 9, inputTokens: 100, outputTokens: 20 },
		});
	});

	test("an outcome outside the declared set is refused, and says what is allowed", () => {
		const { telemetry } = setup();
		const wake = telemetry.begin(trigger);
		expect(() =>
			telemetry.report({ wake: wake.id, outcome: "fixed_everything" }),
		).toThrow(/fixed_pr_opened, no_repro/);
	});

	test("a report may leave out the wake only while exactly one is running", async () => {
		const { telemetry } = setup();
		expect(() => telemetry.report({ outcome: "no_repro" })).toThrow(
			/no wake is running/,
		);
		const first = telemetry.begin(trigger);
		telemetry.report({ outcome: "no_repro" });
		const second = telemetry.begin(trigger);
		expect(() => telemetry.report({ outcome: "no_repro" })).toThrow(
			/wake-1, wake-2/,
		);
		expect((await first.end({ status: "ok" })).outcome.name).toBe("no_repro");
		expect((await second.end({ status: "ok" })).outcome.name).toBe(
			"unclassified",
		);
		expect(() =>
			telemetry.report({ wake: "wake-1", outcome: "no_repro" }),
		).toThrow(/wake-1 is not running/);
	});

	test("a failed wake keeps its error, and is still classified", async () => {
		const { telemetry } = setup();
		const wake = telemetry.begin(trigger);
		const ended = await wake.end({
			status: "timeout",
			error: { type: "timeout", message: "timed out after 5ms" },
		});
		expect(ended.status).toBe("timeout");
		expect(ended.error).toEqual({
			type: "timeout",
			message: "timed out after 5ms",
		});
		expect(ended.outcome.name).toBe("unclassified");
	});

	test("a sink that throws breaks nothing, and the other sinks still get the record", async () => {
		const { telemetry, records } = setup([
			async () => {
				throw new Error("collector down");
			},
			() => {
				throw new Error("thrown before a promise");
			},
		]);
		const wake = telemetry.begin(trigger);
		await wake.end({ status: "ok" });
		expect(records.map((record) => record.phase)).toEqual(["start", "end"]);
	});

	test("a wake under a parent joins its trace, and hands its own on to children", async () => {
		const { telemetry } = setup();
		const parent = parentFromEnv({
			MUPPET_WAKE_ID: "wake-0",
			MUPPET_SYSTEM: "tod",
			TRACEPARENT: `00-${"cd".repeat(16)}-${"ef".repeat(8)}-01`,
		});
		const wake = telemetry.begin(trigger, { parent });
		expect(wake.env()).toEqual({
			MUPPET_WAKE_ID: "wake-1",
			MUPPET_SYSTEM: "desktop-factory",
			TRACEPARENT: `00-${"cd".repeat(16)}-${"ab".repeat(8)}-01`,
		});
		const ended = await wake.end({ status: "ok" });
		expect(ended.parent).toEqual({ wake: "wake-0", system: "tod" });
		expect(ended.trace).toEqual({
			traceId: "cd".repeat(16),
			spanId: "ab".repeat(8),
			parentSpanId: "ef".repeat(8),
		});
		expect(parentFromEnv({})).toBeUndefined();
	});
});

describe("work without a model", () => {
	test("is recorded as a workflow, its outcome reported by the code that did it", async () => {
		const { telemetry } = setup();
		const pass = telemetry.begin(trigger, { model: false });
		pass.effect({ kind: "pr_opened", id: "3" });
		pass.report({ outcome: "fixed_pr_opened" });
		const ended = await pass.end({ status: "ok" });
		expect(ended.operation).toBe("invoke_workflow");
		expect(ended.outcome.check).toBe("confirmed");
		expect(attributes(ended)["gen_ai.operation.name"]).toBe("invoke_workflow");
	});
});

describe("jsonlSink", () => {
	test("appends each record as one line that parses back to it", async () => {
		const lines: string[] = [];
		const { telemetry } = setup([
			jsonlSink({
				file: "/state/log/wakes.jsonl",
				append: async (path, text) => {
					lines.push(`${path} ${text}`);
				},
			}),
		]);
		const ended = await telemetry.begin(trigger).end({ status: "ok" });
		expect(lines).toHaveLength(2);
		const [, line = ""] = lines;
		expect(line).toStartWith("/state/log/wakes.jsonl {");
		expect(line).toEndWith("}\n");
		expect(WakeRecord.parse(JSON.parse(line.slice(line.indexOf("{"))))).toEqual(
			ended,
		);
	});
});

describe("wakeTelemetry.agent", () => {
	const context = (request: string): WakeContext => ({
		request,
		systemPrompt: "You are the factory.",
		event: { name: "reports", payload: { report: "MC-4321" } },
		state: { code: codeMode({}, {}, scripts()) },
	});

	test("wraps an agent: one record per wake, the trigger from its event, and the outcome it reports", async () => {
		const { telemetry, records } = setup();
		const prompts: string[] = [];
		const agent = telemetry.agent({
			trigger: (event) => ({
				kind: "event",
				source: event.name,
				ids: { report: "MC-4321" },
			}),
			wake: async ({ systemPrompt }, wake): Promise<Woke> => {
				prompts.push(systemPrompt);
				wake.session({ id: "sess-9", agent: "claude" });
				telemetry.report({ wake: wake.id, outcome: "no_repro" });
				return { kind: "done", reply: "nothing to see" };
			},
		});

		expect(await agent.wake(context("triage"))).toEqual({
			kind: "done",
			reply: "nothing to see",
		});
		expect(prompts[0]).toStartWith("You are the factory.\n\n");
		expect(prompts[0]).toContain("wake-1");
		expect(prompts[0]).toContain("no_repro: Could not reproduce it.");
		const ended = records.at(-1);
		expect(ended?.phase).toBe("end");
		expect(ended?.trigger).toEqual({
			kind: "event",
			source: "reports",
			ids: { report: "MC-4321" },
		});
		expect(ended?.phase === "end" && ended.outcome.name).toBe("no_repro");
		expect(ended?.phase === "end" && ended.status).toBe("ok");
	});

	test("an agent that fails or throws ends its wake failed, with the kind of error it named", async () => {
		const { telemetry, records } = setup();
		const agent = telemetry.agent({
			trigger: (event) => ({ kind: "event", source: event.name, ids: {} }),
			wake: async ({ request }, wake): Promise<Woke> => {
				if (request === "throw") throw new Error("boom");
				wake.error("timeout");
				return { kind: "failed", error: "timed out after 5ms" };
			},
		});
		expect(await agent.wake(context("late"))).toEqual({
			kind: "failed",
			error: "timed out after 5ms",
		});
		const thrown = await agent.wake(context("throw"));
		expect(thrown.kind).toBe("failed");
		const ends = records.flatMap((record) =>
			record.phase === "end" ? [record] : [],
		);
		expect(ends.map((end) => [end.status, end.error?.type])).toEqual([
			["timeout", "timeout"],
			["failed", "error"],
		]);
		expect(ends[1]?.error?.message).toContain("boom");
	});

	test("effects the system observes after the wake are cross-checked against the report", async () => {
		const { telemetry, records } = setup();
		const agent = telemetry.agent({
			trigger: (event) => ({ kind: "event", source: event.name, ids: {} }),
			wake: async (_, wake): Promise<Woke> => {
				telemetry.report({ wake: wake.id, outcome: "no_repro" });
				return { kind: "done", reply: "" };
			},
			effects: async () => [{ kind: "pr_opened", id: "12" }],
		});
		await agent.wake(context("triage"));
		const ended = records.at(-1);
		expect(ended?.phase === "end" && ended.outcome).toEqual({
			name: "fixed_pr_opened",
			source: "observed",
			check: "contradicted",
			reported: "no_repro",
			observed: "fixed_pr_opened",
		});
	});
});
