import { serve } from "../core/behavior.ts";
import { lifecycle } from "../core/hook.ts";
import type { Runtime } from "../core/runtime.ts";
import {
	agentState,
	onWorkers,
	type Options,
	pool,
	reportFailures,
	systemPromptFor,
	wakeAgent,
	wakeContext,
	wakeFromHandlers,
} from "./pieces.ts";

export type FactoryOptions = Options & {
	/**
	 * How many events are handled at once, across all sources. A handler holds
	 * its worker until it returns, through any wakes it asks for, so this is
	 * also how many agents are awake at once when a handler wakes one at a time.
	 */
	readonly workers: number;
};

/**
 * For factories: work through events as fast as the machine allows, with
 * nobody waiting on a reply. Unlike `simple` and `parallel`, no event waits
 * for the one before it. Every event goes to a worker the moment one is
 * free, whatever its source, so events of one source are handled at the same
 * time and may finish out of order, and a slow event holds back nothing but
 * its own worker.
 *
 * `workers` bounds the work, so a burst of events can't start more agents
 * than the machine can run. When every worker is busy, sources aren't read
 * further: events wait wherever the source keeps them, not in a queue here.
 *
 * Wakes, hooks and failures work as in `simple`. Hook handlers take no
 * worker and each hook's events are handled in turn, so keep them short.
 * The run ends once every source has ended and every event is handled.
 * Runs of one `factory` share its workers.
 */
export const factory = ({
	systemPrompt,
	workers,
	...scripts
}: FactoryOptions): Runtime => {
	// Made here, so a number that can't be a pool's is refused before anything runs.
	const start = pool(workers);
	return {
		run: async (behavior) => {
			const run = lifecycle();
			const schedule = onWorkers({ run, start });
			const state = agentState(behavior, scripts);
			const build = wakeContext({
				systemPrompt: systemPromptFor(state, systemPrompt),
				state,
			});
			const wake = wakeAgent({ agent: behavior.decorations.agent, run });
			await serve(behavior, run, {
				wakeFor: wakeFromHandlers({ run, build, wake }),
				accept: reportFailures(run),
				schedule,
			});
		},
	};
};
