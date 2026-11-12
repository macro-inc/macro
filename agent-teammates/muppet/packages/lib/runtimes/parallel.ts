import { serve } from "../core/behavior.ts";
import { lifecycle } from "../core/hook.ts";
import type { Runtime } from "../core/runtime.ts";
import {
	agentState,
	type Options,
	reportFailures,
	systemPromptFor,
	wakeAgent,
	wakeContext,
	wakeFromHandlers,
} from "./pieces.ts";

/**
 * Like `simple`, except that sources don't wait on each other's wakes. Each
 * source is its own queue: it handles one event at a time, and moves on only
 * once the wakes that event caused have finished. Different sources run in
 * parallel, so the agent can be awake for several sources at once.
 */
export const parallel = ({ systemPrompt, ...scripts }: Options): Runtime => ({
	run: async (behavior) => {
		const run = lifecycle();
		const state = agentState(behavior, scripts);
		const build = wakeContext({
			systemPrompt: systemPromptFor(state, systemPrompt),
			state,
		});
		const wake = wakeAgent({ agent: behavior.decorations.agent, run });
		await serve(behavior, run, {
			wakeFor: wakeFromHandlers({ run, build, wake }),
			accept: reportFailures(run),
		});
	},
});
