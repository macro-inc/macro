/**
 * The schedules interface: the only way schedules are added, changed, read
 * or fired. They are kept in state, so the agent can schedule things while
 * it runs, e.g. a reminder in three hours, and a change takes effect
 * without a restart.
 */
import type { Source } from "../../core/event.ts";
import type { Schedule } from "./schedule.ts";

/** One firing, as handlers receive it. */
export type Fired = {
	readonly name: string;
	/** When it was due, ISO 8601. */
	readonly due: string;
	/** Whatever JSON the schedule was given, e.g. what a reminder should say. */
	readonly data?: Schedule["data"];
};

/** One schedule, as anyone asking about it sees it. */
export type Status = {
	readonly name: string;
	readonly schedule: Schedule;
	/** One line of English, e.g. `every 10m`, `every hour at minute 1 and 31`. */
	readonly when: string;
	/** When it next fires, ISO 8601, or null if it won't. */
	readonly next: string | null;
	readonly paused: boolean;
	readonly running: boolean;
	/** When it last finished. */
	readonly last?: string;
	/** Firings passed over because they were too late. */
	readonly missed?: number;
	/** Why it can't be scheduled, if it can't. */
	readonly error?: string;
};

/** The result of a change. */
export type Changed =
	| { readonly kind: "changed"; readonly status: Status }
	| { readonly kind: "removed"; readonly name: string }
	| { readonly kind: "invalid"; readonly error: string }
	| { readonly kind: "unknown"; readonly name: string };

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
