import type { Agent } from "./agent.ts";
import type { Behavior, FailuresHandled } from "./behavior.ts";

/**
 * Runs a behavior: reads its sources, runs its handlers, and wakes the agent
 * in its context when they ask. Start one with `behavior().run(runtime)`,
 * which compiles only once the context has an `agent` and a handler is
 * subscribed to `hooks.failed`.
 */
export type Runtime = {
	readonly run: <
		Needs,
		Provided extends Needs & { readonly agent: Agent },
		Sources,
	>(
		behavior: Behavior<Needs, Provided, Sources, FailuresHandled>,
	) => Promise<void>;
};
