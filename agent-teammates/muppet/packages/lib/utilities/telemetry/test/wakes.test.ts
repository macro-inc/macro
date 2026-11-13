import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { traceBytes, type WakeTrace } from "../../traces/index.ts";
import {
	type Ended,
	macroSink,
	type Started,
	type WakeClient,
	type WakeRecord,
} from "../index.ts";

const fixture = join(
	import.meta.dir,
	"../../traces/test/fixtures/claude.jsonl",
);
const transcript = async (): Promise<unknown[]> =>
	(await Bun.file(fixture).text())
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line): unknown => JSON.parse(line));

/** Lets every promise that can settle, settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A clock whose time moves only when the test says. */
const fakeClock = () => {
	let now = 0;
	const sleepers: { at: number; resolve: () => void }[] = [];
	return {
		sleep: (milliseconds: number) =>
			new Promise<void>((resolve) => {
				sleepers.push({ at: now + milliseconds, resolve });
			}),
		advance: async (milliseconds: number) => {
			const target = now + milliseconds;
			for (;;) {
				await settle();
				sleepers.sort((a, b) => a.at - b.at);
				const next = sleepers[0];
				if (next === undefined || next.at > target) break;
				sleepers.shift();
				now = next.at;
				next.resolve();
			}
			now = target;
			await settle();
		},
	};
};

const started: Started = {
	v: 1,
	phase: "start",
	system: "pr-factory",
	wake: "wake-1",
	trace: { traceId: "ab".repeat(16), spanId: "cd".repeat(8) },
	trigger: { kind: "event", source: "ciFailures", ids: { pr: "1" } },
	startedAt: "2026-11-11T09:00:00.000Z",
};
const session: Started = {
	...started,
	phase: "session",
	session: { id: "11111111-2222-4333-8444-555555555555", agent: "claude" },
};
const ended: Ended = {
	...session,
	phase: "end",
	endedAt: "2026-11-11T09:01:00.000Z",
	durationMs: 60_000,
	status: "ok",
	outcome: { name: "unclassified", source: "none", check: "not_reported" },
	effects: [],
};

const recording = () => {
	const records: WakeRecord[] = [];
	const traces: { wake: string; trace: WakeTrace }[] = [];
	const client: WakeClient = {
		recordWake: async (record) => {
			records.push(record);
		},
		uploadTrace: async (wake, trace) => {
			traces.push({ wake, trace });
		},
	};
	return { records, traces, client };
};

describe("macroSink", () => {
	test("sends every record as it is", async () => {
		const { records, client } = recording();
		const sink = macroSink({ client, clock: fakeClock() });
		for (const record of [started, session, ended]) await sink(record);
		expect(records).toEqual([started, session, ended]);
	});

	test("survives a client that throws or rejects", async () => {
		const clock = fakeClock();
		const sink = macroSink({
			client: {
				recordWake: () => {
					throw new Error("down");
				},
				uploadTrace: () => Promise.reject(new Error("down")),
			},
			clock,
			traces: { transcript, secrets: async () => [] },
		});
		await sink(started);
		await sink(session);
		await clock.advance(120_000);
		await sink(ended);
	});

	test("waits on a slow Macro no longer than the timeout", async () => {
		const clock = fakeClock();
		const sink = macroSink({
			client: {
				recordWake: () => new Promise<void>(() => {}),
				uploadTrace: async () => {},
			},
			clock,
			timeoutMs: 5_000,
		});
		let done = false;
		const sent = sink(started).then(() => {
			done = true;
		});
		await clock.advance(4_999);
		expect(done).toBe(false);
		await clock.advance(1);
		await sent;
		expect(done).toBe(true);
	});

	test("uploads the trace while the wake runs, only when it changed, and once more at the end", async () => {
		const clock = fakeClock();
		const { records, traces, client } = recording();
		const lines = await transcript();
		const asked: unknown[] = [];
		const sink = macroSink({
			client,
			clock,
			traces: {
				transcript: async (of) => {
					asked.push(of);
					return [...lines];
				},
				secrets: async () => ["fake-deploy-key-123456"],
				intervalMs: 60_000,
			},
		});
		await sink(started);
		await clock.advance(0);
		expect(traces).toEqual([]);

		await sink(session);
		await clock.advance(0);
		expect(asked).toEqual([session.session]);
		expect(traces.map(({ wake, trace }) => [wake, trace.live])).toEqual([
			["wake-1", true],
		]);
		expect(JSON.stringify(traces[0]?.trace)).not.toContain(
			"fake-deploy-key-123456",
		);

		await clock.advance(60_000);
		expect(traces).toHaveLength(1); // unchanged, not sent again

		lines.push({
			type: "user",
			timestamp: "2026-11-11T09:00:30.000Z",
			sessionId: "11111111-2222-4333-8444-555555555555",
			message: { role: "user", content: "and one more thing" },
		});
		await clock.advance(59_999);
		expect(traces).toHaveLength(1);
		await clock.advance(1);
		expect(traces).toHaveLength(2);
		expect(traces[1]?.trace.endedAt).toBe("2026-11-11T09:00:30.000Z");

		await sink(ended);
		expect(traces).toHaveLength(3);
		expect(traces[2]?.trace.live).toBe(false);
		expect(records.map((record) => record.phase)).toEqual([
			"start",
			"session",
			"end",
		]);

		lines.push({
			type: "user",
			timestamp: "2026-11-11T09:02:00.000Z",
			sessionId: "11111111-2222-4333-8444-555555555555",
			message: { role: "user", content: "too late" },
		});
		const askedAtEnd = asked.length;
		await clock.advance(600_000);
		expect(traces).toHaveLength(3);
		expect(asked).toHaveLength(askedAtEnd);
	});

	test("uploads at the end even if it never saw the session record", async () => {
		const { traces, client } = recording();
		const sink = macroSink({
			client,
			clock: fakeClock(),
			traces: { transcript, secrets: async () => [] },
		});
		await sink(ended);
		expect(traces.map(({ trace }) => trace.live)).toEqual([false]);
	});

	test("never uploads a trace over the limit", async () => {
		const { traces, client } = recording();
		const limit = 1_000; // the whole trace is about 1,300 bytes
		const sink = macroSink({
			client,
			clock: fakeClock(),
			traces: { transcript, secrets: async () => [], limit },
		});
		await sink(ended);
		const [uploaded] = traces;
		expect(uploaded).toBeDefined();
		if (uploaded !== undefined)
			expect(traceBytes(uploaded.trace)).toBeLessThanOrEqual(limit);
	});

	test("does not send a trace when there is no transcript", async () => {
		const { traces, client } = recording();
		const sink = macroSink({
			client,
			clock: fakeClock(),
			traces: { transcript: async () => undefined, secrets: async () => [] },
		});
		await sink(session);
		await sink(ended);
		expect(traces).toEqual([]);
	});
});
