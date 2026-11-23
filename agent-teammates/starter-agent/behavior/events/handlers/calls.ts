import { behavior } from "@muppet/lib/core/behavior";
import type { CallsContext } from "../../capabilities/calls/context.ts";
import { tick } from "../../capabilities/calls/watch.ts";
import type { callsSources } from "../sources/calls.ts";

/**
 * The call watcher: for each reading of the world, does what the arbiter
 * says, so the agent is in at most one call. It never wakes the agent: the voice on a
 * call is that call's own process, with its own session.
 */
export const callsHandlers = (sources: ReturnType<typeof callsSources>) =>
	behavior<CallsContext>()
		.use(sources)
		.on(
			(sources) => sources.calls,
			async (world, { calls: { watcher } }) => {
				watcher.next.ms = await tick(world, watcher.state, watcher.ports);
			},
		);
