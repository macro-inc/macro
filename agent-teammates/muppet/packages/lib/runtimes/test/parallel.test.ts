import { describe, expect, test } from "bun:test";
import type { Agent } from "../../core/agent.ts";
import { behavior } from "../../core/behavior.ts";
import { source } from "../../core/event.ts";
import type { Runtime } from "../../core/runtime.ts";
import { parallel } from "../parallel.ts";
import type { Options } from "../pieces.ts";
import { simple } from "../simple.ts";
import { scripts } from "./scripts.ts";

const code = scripts();

async function* twice(name: string) {
	yield `${name}1`;
	yield `${name}2`;
}

/** Runs two sources, each waking the agent for both its events, and records when wakes start and end. */
const record = async (runtime: (options: Options) => Runtime) => {
	const timeline: string[] = [];
	const prompts = new Map<string, string>();
	const agent: Agent = {
		wake: async ({ request, systemPrompt }) => {
			timeline.push(`start ${request}`);
			prompts.set(request, systemPrompt);
			await new Promise((resolve) => setTimeout(resolve, 20));
			timeline.push(`end ${request}`);
			return { kind: "done", reply: "ok" };
		},
	};

	await behavior()
		.decorate({ agent })
		.source({ a: source(twice("a")), b: source(twice("b")) })
		.on(
			(sources) => sources.a,
			async (event, { wake }) => {
				await wake(event);
			},
		)
		.on(
			(sources) => sources.b,
			async (event, { wake }) => {
				await wake(event);
			},
		)
		.on(
			(sources) => sources.hooks.preWake,
			async ({ wake, add }) => add(`about ${wake.request}`),
		)
		.on(
			(sources) => sources.hooks.failed,
			async ({ kind, error }) => {
				timeline.push(`failed ${kind} ${error}`);
			},
		)
		.run(runtime({ systemPrompt: "base", ...code }));

	return { timeline, prompts };
};

const before = (timeline: readonly string[], first: string, second: string) =>
	timeline.indexOf(first) < timeline.indexOf(second);

describe("parallel", () => {
	test("wakes for different sources at the same time", async () => {
		const { timeline } = await record(parallel);
		expect(before(timeline, "start b1", "end a1")).toBe(true);
		expect(before(timeline, "start a1", "end b1")).toBe(true);
	});

	test("keeps each source's events in order, one at a time", async () => {
		const { timeline } = await record(parallel);
		expect(before(timeline, "end a1", "start a2")).toBe(true);
		expect(before(timeline, "end b1", "start b2")).toBe(true);
		expect(timeline).toHaveLength(8);
	});

	test("gives each wake only its own pre-wake context", async () => {
		const { prompts } = await record(parallel);
		for (const request of ["a1", "a2", "b1", "b2"])
			expect(prompts.get(request)?.endsWith(`base\n\nabout ${request}`)).toBe(
				true,
			);
	});

	test("unlike simple, which wakes for one source at a time", async () => {
		const { timeline } = await record(simple);
		for (let i = 0; i < timeline.length; i += 2)
			expect(timeline[i + 1]).toBe(timeline[i]?.replace("start", "end"));
	});
});
