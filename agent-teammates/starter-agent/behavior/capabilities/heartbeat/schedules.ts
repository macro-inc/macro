/**
 * What the agent runs on a clock. The scheduler is lib's; this is what the
 * heartbeat adds to it: the standing schedules, and schedules that act by
 * themselves from their `data` (a line to the owner, a wake with a request, a
 * watch on a file), so a reminder needs no handler written for its name.
 */
import type {
	Fired,
	Schedule,
	Schedules,
} from "@muppet/lib/utilities/schedules";
import { z } from "zod";

/** The heartbeat: every 30 minutes. */
export const tick = "tick";
/** The schedules that must exist for the agent to run. */
export const standing: Readonly<Record<string, Schedule>> = {
	[tick]: {
		rule: "FREQ=HOURLY;BYMINUTE=1,31",
		// A tick missed while the agent was down still runs once when it is back.
		catchUp: true,
		why: "the heartbeat: commit and check the agent's repository, prune, and wake the agent when what it watches changed",
	},
};

/**
 * Adds each standing schedule that isn't there. A schedule is state, not
 * code, so the agent can change its own: one that exists is left exactly as
 * it is, or a restart would undo the change.
 */
export const ensureSchedules = async (
	schedules: Pick<Schedules, "list" | "set">,
): Promise<void> => {
	const existing = (await schedules.list()).map(({ name }) => name);
	for (const [name, schedule] of Object.entries(standing)) {
		if (existing.includes(name)) continue;
		const added = await schedules.set(name, schedule);
		if (added.kind === "invalid") throw new Error(added.error);
	}
};

/** What a schedule's `data` may say it does when it fires. */
export const Act = z.object({
	/** DM the owner this line. No model runs. */
	dmOwner: z.string().min(1).optional(),
	/** Wake the agent with this request. */
	wake: z.string().min(1).optional(),
	/** Do nothing until this file exists; then act once, and remove the schedule. */
	ifFile: z.string().min(1).optional(),
});
export type Act = z.infer<typeof Act>;

export type Action =
	/** The firing isn't one of these, or its file isn't there yet. */
	| { readonly kind: "none" }
	| {
			readonly kind: "dm" | "wake";
			readonly text: string;
			/** The schedule is a watch that has now seen its file: it ends itself once it has acted. */
			readonly thenRemove: boolean;
	  };

/** The file a firing waits on, if it is a watch. */
export const watched = ({ data }: Fired): string | undefined => {
	const act = Act.safeParse(data);
	return act.success ? act.data.ifFile : undefined;
};

/** What a firing does by itself, given whether the file it watches (if any) exists. */
export const actionOf = ({ data }: Fired, fileExists: boolean): Action => {
	const act = Act.safeParse(data);
	if (!act.success) return { kind: "none" };
	const { dmOwner, wake, ifFile } = act.data;
	if (ifFile !== undefined && !fileExists) return { kind: "none" };
	const thenRemove = ifFile !== undefined;
	if (dmOwner !== undefined) return { kind: "dm", text: dmOwner, thenRemove };
	if (wake !== undefined) return { kind: "wake", text: wake, thenRemove };
	return { kind: "none" };
};
