import type {
	Agent,
	AgentState,
	EventContext,
	WakeContext,
	Woke,
} from "../core/agent.ts";
import {
	type Accept,
	type Behavior,
	type Event,
	inTurn,
	type Schedule,
	type WakeFor,
} from "../core/behavior.ts";
import type { Signatures } from "../core/capability.ts";
import { codeMode, type Exported, type Load } from "../core/code.ts";
import { describeError } from "../core/error.ts";
import type { Lifecycle } from "../core/hook.ts";
import { framework } from "../core/prompt.ts";

/** Small pieces runtimes are composed from. */

export type Options = {
	/** The agent's base system prompt, e.g. its AGENT.md. */
	readonly systemPrompt: string;
	/** Type-checks and loads the scripts the agent writes. */
	readonly load: Load;
	/** Reads a module capability's functions from its code, for its docs. */
	readonly signatures: Signatures;
	/** The agent's `Script` type: `Script<Context>` of its own context, which `load` holds every script to. */
	readonly script: Exported;
};

/** What code mode needs beyond the behavior: how scripts load, and how modules are described. */
export type Scripts = Pick<Options, "load" | "signatures" | "script">;

/** What the agent works with while awake: its capabilities, through code mode. */
export const agentState = <Needs, Provided extends Needs, Sources, Failures>(
	behavior: Behavior<Needs, Provided, Sources, Failures>,
	scripts: Scripts,
): AgentState => ({
	code: codeMode(behavior.capabilities, behavior.decorations, scripts),
});

/** How every script starts: its `main`, typed by the agent's `Script`. */
export const scriptStart = ({ file, name }: Exported): string =>
	[
		`import type { ${name} } from ${JSON.stringify(file)};`,
		"",
		`export async function main({ context, log }: ${name}) {`,
	].join("\n");

/** The framework's prompt, how the agent's scripts start, its catalog, then its own prompt. */
export const systemPromptFor = (
	state: AgentState,
	systemPrompt: string,
): string =>
	[
		framework,
		`## Your scripts\n\nA script starts like this, so that \`context\` is typed:\n\n${scriptStart(state.code.script)}`,
		...(state.code.catalog === ""
			? []
			: [`## Your catalog\n\n${state.code.catalog}`]),
		systemPrompt,
	].join("\n\n");

/** Builds the context for waking the agent with a request, for an event. */
export const wakeContext =
	({
		systemPrompt,
		state,
	}: {
		readonly systemPrompt: string;
		readonly state: AgentState;
	}) =>
	(request: string, event: EventContext): WakeContext => ({
		request,
		systemPrompt,
		event,
		state,
	});

/**
 * Wakes the agent: fires `preWake` and adds what its handlers `add` to the
 * system prompt, then fires `postReply`, or `failed` if the agent threw or
 * reported failing. Returns the agent's reply.
 */
export const wakeAgent =
	({ agent, run }: { readonly agent: Agent; readonly run: Lifecycle }) =>
	async (wake: WakeContext): Promise<Woke> => {
		const added: string[] = [];
		await run.fire.preWake({ wake, add: (text) => added.push(text) });
		const woke = await agent
			.wake({
				...wake,
				systemPrompt: [wake.systemPrompt, ...added].join("\n\n"),
			})
			.catch(
				(error: unknown): Woke => ({
					kind: "failed",
					error: describeError(error),
				}),
			);
		if (woke.kind === "done")
			await run.fire.postReply({ wake, reply: woke.reply });
		else await run.fire.failed({ kind: "wake", wake, error: woke.error });
		return woke;
	};

/** Makes calls to `f` run one after another, each starting when the last has finished. */
export const oneAtATime = <Args extends readonly unknown[], Result>(
	f: (...args: Args) => Promise<Result>,
): ((...args: Args) => Promise<Result>) => {
	let last: Promise<unknown> = Promise.resolve();
	return (...args) => {
		const next = last.then(() => f(...args));
		last = next.catch(() => undefined);
		return next;
	};
};

/**
 * Wakes the agent for handlers, refusing wakes from hook handlers: a hook
 * handler waking the agent would wait on the wake that fired the hook.
 */
export const wakeFromHandlers = ({
	run,
	build,
	wake,
}: {
	readonly run: Lifecycle;
	readonly build: (request: string, event: EventContext) => WakeContext;
	readonly wake: (wake: WakeContext) => Promise<Woke>;
}): WakeFor => {
	const hooks: readonly unknown[] = Object.values(run.hooks);
	return async (request, { name, payload, source }: Event) =>
		hooks.includes(source)
			? { kind: "failed", error: "hook handlers can't wake the agent" }
			: wake(build(request, { name, payload }));
};

/** Reports a handler that threw on `failed`, unless it was handling `failed` itself. */
export const reportFailures =
	(run: Lifecycle): Accept =>
	async (handled, { name, payload, source }) => {
		if (handled.kind === "failed" && source !== run.hooks.failed)
			await run.fire.failed({
				kind: "handler",
				event: { name, payload },
				error: handled.error,
			});
	};

/**
 * A pool of `workers`. Giving it work resolves once a worker has started the
 * work, not when the work is done, so whoever gives it work is held back only
 * while every worker is busy. Nothing is queued beyond the callers waiting
 * for a worker. Work that rejects frees its worker like any other.
 */
export const pool = (
	workers: number,
): ((work: () => Promise<void>) => Promise<void>) => {
	if (!Number.isInteger(workers) || workers < 1)
		throw new Error(
			`a pool needs a whole number of workers, at least 1: got ${workers}`,
		);
	let free = workers;
	const waiting: (() => void)[] = [];
	/** Hands the worker to whoever has waited longest, or frees it. */
	const release = (): void => {
		const next = waiting.shift();
		if (next === undefined) free += 1;
		else next();
	};
	return async (work) => {
		if (free > 0) free -= 1;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		// try, not .then: work that isn't async can throw before it returns a promise.
		void (async () => {
			try {
				await work();
			} catch {
				// Work reports its own failures; a worker only has to be freed.
			} finally {
				release();
			}
		})();
	};
};

/**
 * Handles events on a pool's workers, given how the pool starts work: a
 * source moves to its next event as soon as a worker has started on this
 * one, and waits only when every worker is busy. Hook events are handled in
 * turn and take no worker: the wake that fired one is waiting on its
 * handlers, on a worker of its own.
 */
export const onWorkers = ({
	run,
	start,
}: {
	readonly run: Lifecycle;
	readonly start: (work: () => Promise<void>) => Promise<void>;
}): Schedule => {
	const hooks: readonly unknown[] = Object.values(run.hooks);
	return (handling, event) =>
		hooks.includes(event.source) ? inTurn(handling, event) : start(handling);
};
