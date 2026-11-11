/**
 * The schedules interface: the only way schedules are added, changed, read
 * or fired. They are kept in state, so the agent can schedule things while
 * it runs, e.g. a reminder in three hours, and a change takes effect
 * without a restart.
 */
import { z } from "zod";
import type { Source } from "../../core/event.ts";
import { Schedule } from "./schedule.ts";

/** One firing, as handlers receive it. */
export type Fired = {
	readonly name: string;
	/** When it was due, ISO 8601. */
	readonly due: string;
	readonly data?: z.core.util.JSONType;
};

/** One schedule, as anyone asking about it sees it. */
export const Status = z.strictObject({
	name: z.string(),
	schedule: Schedule,
	/** One line of English, e.g. `every 10m`, `every hour at minute 1 and 31`. */
	when: z.string(),
	/** When it next fires, ISO 8601, or null if it won't. */
	next: z.string().nullable(),
	paused: z.boolean(),
	running: z.boolean(),
	/** When it last finished. */
	last: z.string().optional(),
	/** Firings passed over because they were too late. */
	missed: z.number().optional(),
	/** Why it can't be scheduled, if it can't. */
	error: z.string().optional(),
});
export type Status = z.infer<typeof Status>;

/** The result of a change. */
export const Changed = z.union([
	z.strictObject({ kind: z.literal("changed"), status: Status }),
	z.strictObject({ kind: z.literal("removed"), name: z.string() }),
	z.strictObject({ kind: z.literal("invalid"), error: z.string() }),
	z.strictObject({ kind: z.literal("unknown"), name: z.string() }),
]);
export type Changed = z.infer<typeof Changed>;

export type Schedules = {
	/** Adds a schedule, or replaces one by the same name and forgets what it has done. */
	readonly set: (name: string, schedule: Schedule) => Promise<Changed>;
	readonly remove: (name: string) => Promise<Changed>;
	/** Stops it firing until it is resumed. */
	readonly pause: (name: string) => Promise<Changed>;
	readonly resume: (name: string) => Promise<Changed>;
	/** Every schedule, soonest first. */
	readonly list: () => Promise<readonly Status[]>;
	/** Fires each schedule when it is due. The next firing waits for every handler to finish. */
	readonly fired: Source<Fired>;
};
