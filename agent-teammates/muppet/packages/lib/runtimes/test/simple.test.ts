import { describe, expect, test } from "bun:test";
import type { WakeContext, Woke } from "../../core/agent.ts";
import { behavior } from "../../core/behavior.ts";
import { module } from "../../core/capability.ts";
import { source } from "../../core/event.ts";
import { framework } from "../../core/prompt.ts";
import { simple } from "../simple.ts";
import { scripts, scriptsPrompt } from "./scripts.ts";

// Every script is the same module, so the test needs no files.
const scale = async (_: unknown, n: number) => n * 10;
const code = scripts({
	main: ({ context }: { context: unknown }) => scale(context, 4),
});

async function* numbers() {
	yield 1;
	yield 2;
	yield 3;
}

describe("simple", () => {
	test("wakes the agent from its context with the request, event, prompt and code mode", async () => {
		const wakes: Omit<WakeContext, "state">[] = [];
		const executed: unknown[] = [];
		const replies: Woke[] = [];

		await behavior()
			.decorate({
				agent: {
					wake: async ({ state, ...wake }: WakeContext): Promise<Woke> => {
						wakes.push(wake);
						executed.push(await state.code.execute("source"));
						return { kind: "done", reply: `re ${wake.request}` };
					},
				},
			})
			.source({ numbers: source(numbers()) })
			.capability(
				module({
					name: "scaling",
					summary: "Scales a number.",
					file: import.meta.path,
					functions: { scale },
				}),
			)
			.on(
				(sources) => sources.numbers,
				async (n, { wake }) => {
					if (n % 2 === 1) replies.push(await wake(`odd ${n}`));
				},
			)
			.on(
				(sources) => sources.hooks.failed,
				async ({ kind, error }) => {
					replies.push({ kind: "failed", error: `${kind} ${error}` });
				},
			)
			.run(simple({ systemPrompt: "base", ...code }));

		const prompt = `${framework}\n\n${scriptsPrompt}\n\n## Your catalog\n\n- scaling (module): Scales a number. Functions: scale.\n\nbase`;
		expect(wakes).toEqual([
			{
				request: "odd 1",
				systemPrompt: prompt,
				event: { name: "numbers", payload: 1 },
			},
			{
				request: "odd 3",
				systemPrompt: prompt,
				event: { name: "numbers", payload: 3 },
			},
		]);
		expect(executed).toEqual([
			{ kind: "succeeded", output: 40, logs: "" },
			{ kind: "succeeded", output: 40, logs: "" },
		]);
		expect(replies).toEqual([
			{ kind: "done", reply: "re odd 1" },
			{ kind: "done", reply: "re odd 3" },
		]);
	});

	test("fires preWake before each wake and postReply after, refuses wakes from hooks, and ends", async () => {
		const seen: string[] = [];

		await behavior()
			.decorate({
				agent: {
					wake: async ({
						request,
						systemPrompt,
					}: WakeContext): Promise<Woke> => {
						seen.push(`wake ${request} [${systemPrompt}]`);
						return { kind: "done", reply: `re ${request}` };
					},
				},
			})
			.source({ numbers: source(numbers()) })
			.on(
				(sources) => sources.numbers,
				async (n, { wake }) => {
					await wake(`n ${n}`);
				},
			)
			.on(
				(sources) => sources.hooks.preWake,
				async ({ wake, add }) => {
					seen.push(`pre ${wake.request}`);
					add(`about ${wake.event.payload}`);
				},
			)
			.on(
				(sources) => sources.hooks.postReply,
				async ({ reply }, { wake }) => {
					seen.push(`post ${reply}`);
					const woke = await wake("hooks can't wake");
					seen.push(woke.kind === "failed" ? woke.error : "woke");
				},
			)
			.on(
				(sources) => sources.hooks.failed,
				async ({ kind, error }) => {
					seen.push(`failed ${kind} ${error}`);
				},
			)
			.run(simple({ systemPrompt: "base", ...code }));

		const refused = "hook handlers can't wake the agent";
		expect(seen).toEqual([
			"pre n 1",
			`wake n 1 [${framework}\n\n${scriptsPrompt}\n\nbase\n\nabout 1]`,
			"post re n 1",
			refused,
			"pre n 2",
			`wake n 2 [${framework}\n\n${scriptsPrompt}\n\nbase\n\nabout 2]`,
			"post re n 2",
			refused,
			"pre n 3",
			`wake n 3 [${framework}\n\n${scriptsPrompt}\n\nbase\n\nabout 3]`,
			"post re n 3",
			refused,
		]);
	});

	test("reports a handler that throws and goes on to the next event", async () => {
		const seen: string[] = [];

		await behavior()
			.decorate({
				agent: {
					wake: async ({ request }: WakeContext): Promise<Woke> => {
						seen.push(`wake ${request}`);
						return { kind: "done", reply: "ok" };
					},
				},
			})
			.source({ numbers: source(numbers()) })
			.on(
				(sources) => sources.numbers,
				(n, { wake }) => {
					if (n === 2) throw new Error("two");
					return wake(`n ${n}`).then(() => undefined);
				},
			)
			.on(
				(sources) => sources.hooks.failed,
				async (failure) => {
					if (failure.kind !== "handler") return;
					const { event, error } = failure;
					seen.push(
						`failed ${event.name} ${event.payload} ${error.split("\n")[0]}`,
					);
					throw new Error("a failing hook handler is not reported again");
				},
			)
			.run(simple({ systemPrompt: "base", ...code }));

		expect(seen).toEqual([
			"wake n 1",
			"failed numbers 2 Error: two",
			"wake n 3",
		]);
	});

	test("reports a failed wake and goes on to the next one", async () => {
		const seen: string[] = [];

		await behavior()
			.decorate({
				agent: {
					wake: async ({ request }: WakeContext): Promise<Woke> => {
						if (request === "n 1") throw new Error("down");
						if (request === "n 2") return { kind: "failed", error: "refused" };
						seen.push(`wake ${request}`);
						return { kind: "done", reply: "ok" };
					},
				},
			})
			.source({ numbers: source(numbers()) })
			.on(
				(sources) => sources.numbers,
				async (n, { wake }) => {
					await wake(`n ${n}`);
				},
			)
			.on(
				(sources) => sources.hooks.failed,
				async (failure) => {
					if (failure.kind !== "wake") return;
					const { wake, error } = failure;
					seen.push(`failed ${wake.request} ${error.split("\n")[0]}`);
				},
			)
			.run(simple({ systemPrompt: "base", ...code }));

		expect(seen).toEqual([
			"failed n 1 Error: down",
			"failed n 2 refused",
			"wake n 3",
		]);
	});
});
