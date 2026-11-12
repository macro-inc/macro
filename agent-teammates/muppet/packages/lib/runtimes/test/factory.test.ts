import { describe, expect, test } from "bun:test";
import type { Agent } from "../../core/agent.ts";
import { behavior } from "../../core/behavior.ts";
import { source } from "../../core/event.ts";
import { factory } from "../factory.ts";
import { pool } from "../pieces.ts";
import { scripts } from "./scripts.ts";

const code = scripts();

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long the agent takes over a request: 20 ms unless the request says otherwise. */
const took = (request: string): number =>
	request.startsWith("slow") ? 80 : request.startsWith("quick") ? 5 : 20;

/**
 * Runs sources that wake the agent for each of their events, and records
 * when events are read, when wakes start and end, and how many were awake
 * at once.
 */
const record = async ({
	workers,
	sources,
}: {
	readonly workers: number;
	readonly sources: Readonly<Record<"a" | "b", readonly string[]>>;
}) => {
	const timeline: string[] = [];
	const prompts = new Map<string, string>();
	let awake = 0;
	let most = 0;
	const agent: Agent = {
		wake: async ({ request, systemPrompt }) => {
			awake += 1;
			most = Math.max(most, awake);
			timeline.push(`start ${request}`);
			prompts.set(request, systemPrompt);
			await sleep(took(request));
			timeline.push(`end ${request}`);
			awake -= 1;
			return request.startsWith("broken")
				? { kind: "failed", error: "it broke" }
				: { kind: "done", reply: "ok" };
		},
	};
	async function* read(events: readonly string[]) {
		for (const event of events) {
			timeline.push(`read ${event}`);
			yield event;
		}
	}

	await behavior()
		.decorate({ agent })
		.source({ a: source(read(sources.a)), b: source(read(sources.b)) })
		.on(
			(all) => all.a,
			async (event, { wake }) => {
				if (event.startsWith("throws")) throw new Error(`no ${event}`);
				await wake(event);
			},
		)
		.on(
			(all) => all.b,
			async (event, { wake }) => {
				await wake(event);
			},
		)
		.on(
			(all) => all.hooks.preWake,
			async ({ wake, add }) => add(`about ${wake.request}`),
		)
		.on(
			(all) => all.hooks.postReply,
			async ({ wake }) => {
				timeline.push(`replied ${wake.request}`);
			},
		)
		.on(
			(all) => all.hooks.failed,
			async ({ kind, error }) => {
				timeline.push(`failed ${kind} ${error.split("\n")[0]}`);
			},
		)
		.run(factory({ systemPrompt: "base", workers, ...code }));

	return { timeline, prompts, most };
};

const before = (timeline: readonly string[], first: string, second: string) =>
	timeline.includes(first) &&
	timeline.includes(second) &&
	timeline.indexOf(first) < timeline.indexOf(second);

describe("factory", () => {
	test("handles one source's events at the same time", async () => {
		const { timeline, most } = await record({
			workers: 8,
			sources: { a: ["a1", "a2", "a3"], b: ["b1", "b2"] },
		});
		expect(before(timeline, "start a2", "end a1")).toBe(true);
		expect(before(timeline, "start a3", "end a1")).toBe(true);
		expect(before(timeline, "start b2", "end a1")).toBe(true);
		expect(most).toBe(5);
	});

	test("a slow event holds back nothing that comes after it", async () => {
		const { timeline } = await record({
			workers: 2,
			sources: { a: ["slow", "quick1", "quick2", "quick3"], b: [] },
		});
		for (const quick of ["quick1", "quick2", "quick3"])
			expect(before(timeline, `end ${quick}`, "end slow")).toBe(true);
	});

	test("never has more events in hand than workers", async () => {
		const events = (name: string) =>
			Array.from({ length: 6 }, (_, i) => `${name}${i}`);
		const { timeline, most } = await record({
			workers: 3,
			sources: { a: events("a"), b: events("b") },
		});
		expect(most).toBe(3);
		expect(timeline.filter((line) => line.startsWith("end "))).toHaveLength(12);
	});

	test("reads a source no further than its workers allow", async () => {
		const { timeline } = await record({
			workers: 1,
			sources: { a: ["a1", "a2", "a3", "a4"], b: [] },
		});
		// One event is on the worker and one is waiting for it; the rest stay in the source.
		expect(before(timeline, "end a1", "read a3")).toBe(true);
		expect(before(timeline, "end a2", "read a4")).toBe(true);
	});

	test("ends only once every event is handled, hooks included", async () => {
		const { timeline } = await record({
			workers: 4,
			sources: { a: ["a1", "a2"], b: ["b1"] },
		});
		for (const request of ["a1", "a2", "b1"])
			expect(before(timeline, `end ${request}`, `replied ${request}`)).toBe(
				true,
			);
	});

	test("gives each wake only its own pre-wake context", async () => {
		const { prompts } = await record({
			workers: 4,
			sources: { a: ["a1", "a2"], b: ["b1", "b2"] },
		});
		for (const request of ["a1", "a2", "b1", "b2"])
			expect(prompts.get(request)?.endsWith(`base\n\nabout ${request}`)).toBe(
				true,
			);
	});

	test("reports a handler that throws and a wake that fails, and goes on", async () => {
		const { timeline } = await record({
			workers: 1,
			sources: { a: ["throws1", "broken1", "a1"], b: [] },
		});
		expect(timeline).toContain("failed handler Error: no throws1");
		expect(timeline).toContain("failed wake it broke");
		expect(timeline).toContain("replied a1");
	});

	test("refuses a number of workers that can't be a pool", () => {
		for (const workers of [0, -1, 1.5, Number.NaN])
			expect(() => factory({ systemPrompt: "base", workers, ...code })).toThrow(
				"at least 1",
			);
	});
});

describe("pool", () => {
	test("starts work at once while a worker is free, and holds back the rest", async () => {
		const start = pool(2);
		const done: string[] = [];
		const work = (name: string, ms: number) => async () => {
			await sleep(ms);
			done.push(name);
		};
		await start(work("first", 30));
		await start(work("second", 10));
		expect(done).toEqual([]);
		await start(work("third", 1));
		// The third started only once the second had freed its worker.
		expect(done).toEqual(["second"]);
		await sleep(50);
		expect(done).toEqual(["second", "third", "first"]);
	});

	test("frees the worker of work that throws", async () => {
		const start = pool(1);
		const done: string[] = [];
		await start(async () => {
			throw new Error("broke");
		});
		await start(() => {
			throw new Error("broke before any promise");
		});
		await start(async () => {
			done.push("after");
		});
		expect(done).toEqual(["after"]);
	});
});
