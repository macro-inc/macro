import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { traceBytes, type WakeTrace } from "../../traces/index.ts";
import {
	type Ended,
	macroSink,
	type Started,
	type WakeClient,
	type WakeRecord,
	WakesUnavailable,
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
/** Lets background work (a file read, then an upload) finish. */
const flush = async () => {
	for (let turn = 0; turn < 20; turn += 1) await settle();
};

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
		const sink = macroSink({
			client,
			clock: fakeClock(),
			secrets: async () => [],
		});
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
			secrets: async () => [],
			traces: { transcript },
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
			secrets: async () => [],
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
			secrets: async () => ["fake-deploy-key-123456"],
			traces: {
				transcript: async (of) => {
					asked.push(of);
					return [...lines];
				},
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
		await flush();
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
			secrets: async () => [],
			traces: { transcript },
		});
		await sink(ended);
		await flush();
		expect(traces.map(({ trace }) => trace.live)).toEqual([false]);
	});

	test("never uploads a trace over the limit", async () => {
		const { traces, client } = recording();
		const limit = 1_000; // the whole trace is about 1,300 bytes
		const sink = macroSink({
			client,
			clock: fakeClock(),
			secrets: async () => [],
			traces: { transcript, limit },
		});
		await sink(ended);
		await flush();
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
			secrets: async () => [],
			traces: { transcript: async () => undefined },
		});
		await sink(session);
		await sink(ended);
		expect(traces).toEqual([]);
	});

	test("skips a tick's upload when a credential can't be read, then carries on", async () => {
		const clock = fakeClock();
		const { traces, client } = recording();
		let readable = false;
		const sink = macroSink({
			client,
			clock,
			secrets: async () => {
				if (!readable) throw new Error("keychain locked");
				return [];
			},
			traces: { transcript, intervalMs: 60_000 },
		});
		await sink(session);
		await clock.advance(0);
		expect(traces).toEqual([]);
		readable = true;
		await clock.advance(60_000);
		expect(traces.map(({ trace }) => trace.live)).toEqual([true]);
		readable = false;
		await sink(ended);
		await flush();
		expect(traces).toHaveLength(1); // no final upload without the credentials
	});

	test("waits for a live upload still under way before the final one", async () => {
		const clock = fakeClock();
		const landed: boolean[] = [];
		let release = () => {};
		const client: WakeClient = {
			recordWake: async () => {},
			uploadTrace: (_, trace) => {
				if (trace.live)
					return new Promise<void>((resolve) => {
						release = () => {
							landed.push(true);
							resolve();
						};
					});
				landed.push(false);
				return Promise.resolve();
			},
		};
		const sink = macroSink({
			client,
			clock,
			secrets: async () => [],
			traces: { transcript },
			timeoutMs: 5_000,
		});
		await sink(session);
		await clock.advance(1_000); // the live upload is under way
		await sink(ended); // returns without waiting on the trace
		await clock.advance(1_000);
		await flush();
		expect(landed).toEqual([]); // the final one waits for the live one
		release();
		await flush();
		expect(landed).toEqual([true, false]); // and lands last
	});

	test("aborts a live upload that outlasts the timeout, and waits on it no longer than that at the end", async () => {
		const clock = fakeClock();
		const signals: AbortSignal[] = [];
		const finals: WakeTrace[] = [];
		const client: WakeClient = {
			recordWake: async () => {},
			uploadTrace: (_, trace, signal) => {
				if (!trace.live) {
					finals.push(trace);
					return Promise.resolve();
				}
				if (signal) signals.push(signal);
				return new Promise<void>(() => {}); // ignores its signal
			},
		};
		const sink = macroSink({
			client,
			clock,
			secrets: async () => [],
			traces: { transcript, intervalMs: 60_000 },
			timeoutMs: 5_000,
		});
		await sink(session);
		await clock.advance(0);
		expect(signals.map((signal) => signal.aborted)).toEqual([false]);
		await clock.advance(5_000);
		expect(signals.map((signal) => signal.aborted)).toEqual([true]);
		await sink(ended);
		await clock.advance(5_000);
		await flush();
		expect(finals.map((trace) => trace.live)).toEqual([false]);
	});

	test("sends nothing more once Macro says the agent has no wakes", async () => {
		const clock = fakeClock();
		let calls = 0;
		const sink = macroSink({
			client: {
				recordWake: async () => {
					calls += 1;
					throw new WakesUnavailable();
				},
				uploadTrace: async () => {
					calls += 1;
				},
			},
			clock,
			secrets: async () => [],
			traces: { transcript },
		});
		await sink(started);
		await sink(session);
		await clock.advance(600_000);
		await sink(ended);
		expect(calls).toBe(1);
	});

	test("sends an unchanged trace again at the heartbeat", async () => {
		const clock = fakeClock();
		const { traces, client } = recording();
		const sink = macroSink({
			client,
			clock,
			secrets: async () => [],
			traces: { transcript, intervalMs: 60_000, heartbeatMs: 180_000 },
		});
		await sink(session);
		await clock.advance(0);
		expect(traces).toHaveLength(1);
		await clock.advance(120_000);
		expect(traces).toHaveLength(1);
		await clock.advance(60_000);
		expect(traces).toHaveLength(2);
		expect(traces[1]?.trace).toEqual(traces[0]?.trace);
	});

	test("redacts a record's error and summaries without traces, and drops them if secrets can't be read", async () => {
		const failed: Ended = {
			...ended,
			status: "failed",
			error: {
				type: "error",
				message:
					"GET https://x.test/?token=abc failed with fake-deploy-key-123456",
			},
			outcome: { ...ended.outcome, summary: "used fake-deploy-key-123456" },
			trigger: {
				...ended.trigger,
				summary: "asked about fake-deploy-key-123456",
			},
		};
		const { records, client } = recording();
		// A sink for records only, with no traces, still redacts them.
		await macroSink({
			client,
			clock: fakeClock(),
			secrets: async () => ["fake-deploy-key-123456"],
		})(failed);
		expect(JSON.stringify(records)).not.toContain("fake-deploy-key-123456");
		expect(JSON.stringify(records)).not.toContain("token=abc");
		expect(records[0]?.trigger.summary).toBe("asked about [secret]");

		const locked = recording();
		await macroSink({
			client: locked.client,
			clock: fakeClock(),
			secrets: async () => {
				throw new Error("keychain locked");
			},
		})(failed);
		const [sent] = locked.records;
		expect(sent?.phase === "end" && sent.error?.message).toBe("[secret]");
		expect(sent?.trigger.summary).toBe("[secret]");
	});
});
