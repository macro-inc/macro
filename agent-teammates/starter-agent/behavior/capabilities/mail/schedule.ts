import type { Schedules } from "@muppet/lib/utilities/schedules";
import { reviewHours, reviewSchedule } from "./config.ts";

/**
 * Makes sure the daily review of the filter is scheduled. A schedule is
 * state, so it is only added if it isn't there: a restart must not undo a
 * change the agent made to it. Without mail credentials it still exists, and
 * its handler does nothing.
 */
export const ensureMailSchedules = async (
	schedules: Pick<Schedules, "list" | "set">,
): Promise<void> => {
	if ((await schedules.list()).some(({ name }) => name === reviewSchedule))
		return;
	const added = await schedules.set(reviewSchedule, {
		every: `${reviewHours}h`,
		why: "Wakes the agent to look at what the mail filter dropped, and tune it if it keeps missing. Does nothing until mail is set up.",
	});
	if (added.kind === "invalid") throw new Error(added.error);
};
