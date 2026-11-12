/**
 * Scheduling as a behavior to `use`: it adds `schedules` to the context, a
 * `schedules` source that fires each schedule when it is due, and
 * capabilities for the agent to add, change and read schedules. Handlers
 * tell firings apart by name:
 *
 *     .on((sources) => sources.schedules, async ({ name, data }) =>
 *       name === "standup" ? [{ kind: "wake", request: "Run standup." }] : [])
 */
import { behavior } from "../../core/behavior.ts";
import { module } from "../../core/capability.ts";
import type { Clock } from "../time/index.ts";
import { grace } from "./due.ts";
import type { Schedule } from "./schedule.ts";
import { scheduler } from "./scheduler.ts";
import type { Changed, Schedules, Status } from "./schedules.ts";
import type { ScheduleStore } from "./store.ts";

export type { Schedule } from "./schedule.ts";
export { scheduler } from "./scheduler.ts";
export type { Changed, Fired, Schedules, Status } from "./schedules.ts";
export { fileStore, memoryStore, type ScheduleStore } from "./store.ts";

type Context = { readonly schedules: Schedules };

const format = `A schedule is one of:
- { every: "10m" }: fires that long after its last run ended, and at once when added. Lengths are like 90s, 10m, 1h30m, 2d or PT1H30M.
- { rule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" }: wall-clock times, as an RFC 5545 RRULE, not cron. Optional tz (an IANA zone, default the scheduler's), from (the instant occurrences count from, default the Unix epoch, so pin the time with BYHOUR and BYMINUTE), and catchUp (fire an occurrence missed while down, instead of skipping it).
- { at: "2026-11-09T15:00:00Z" }: once, at a fixed instant with a Z or an offset.
Any of them may have why (a note for whoever reads it next), data (any JSON, handed to the handlers with every firing, e.g. what a reminder should say), and grace (how late a firing may be and still happen; default ${grace.rule}, or ${grace.once} for at).
A firing reaches your handlers on the schedules source as { name, due, data }, so a schedule does nothing until a handler acts on its name.`;

type Named = { readonly name: string };

/** Adds a schedule, or replaces one by the same name. Replacing a schedule forgets what it has done, and unpauses it. */
export const setSchedule = (
	{ schedules }: Context,
	{ name, schedule }: { readonly name: string; readonly schedule: Schedule },
): Promise<Changed> => schedules.set(name, schedule);

/** Removes a schedule. */
export const removeSchedule = (
	{ schedules }: Context,
	{ name }: Named,
): Promise<Changed> => schedules.remove(name);

/** Stops a schedule firing until it is resumed. */
export const pauseSchedule = (
	{ schedules }: Context,
	{ name }: Named,
): Promise<Changed> => schedules.pause(name);

/** Lets a paused schedule fire again. */
export const resumeSchedule = (
	{ schedules }: Context,
	{ name }: Named,
): Promise<Changed> => schedules.resume(name);

/** Every schedule, soonest first, with when it next fires. */
export const listSchedules = ({
	schedules,
}: Context): Promise<readonly Status[]> => schedules.list();

export const scheduleControl = module({
	name: "schedules",
	summary: "Add, change, pause and read your schedules.",
	docs: format,
	file: import.meta.path,
	functions: {
		setSchedule,
		removeSchedule,
		pauseSchedule,
		resumeSchedule,
		listSchedules,
	},
});

export const scheduling = (options: {
	readonly store: ScheduleStore;
	readonly clock: Clock;
	/** The zone a rule's wall clock means, unless it names its own. */
	readonly tz: string;
	/** Ends the schedules source, e.g. on shutdown. */
	readonly signal?: AbortSignal;
}) => {
	const schedules = scheduler(options);
	return behavior()
		.decorate({ schedules })
		.source({ schedules: schedules.fired })
		.capability(scheduleControl);
};
