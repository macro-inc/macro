/**
 * What should fire, given the schedules, what has run, and the time. Pure:
 * no clock, no files. This is where the scheduling rules live, and where
 * they are tested.
 */
import { z } from "zod";
import { errorMessage } from "../../core/error.ts";
import { instant, milliseconds, timeZone } from "../time/index.ts";
import { nextOccurrence, previousOccurrence } from "./rrule.ts";
import { epoch, type Kind, kindOf, Schedule } from "./schedule.ts";

/** What one schedule has done. Written by the scheduler. */
export const Run = z.strictObject({
	/** The firing the last run was for: a rule's occurrence, or when an `every` came due. */
	due: z.string().optional(),
	started: z.string().optional(),
	ended: z.string().optional(),
	/** A run has started and not ended. */
	running: z.boolean().optional(),
	/** Firings passed over because they were too late to run. */
	missed: z.number().optional(),
	/** Paused by hand: it doesn't fire until it is resumed. */
	paused: z.boolean().optional(),
	/** Nothing left to do: an `at` that has fired, or was too late to. */
	spent: z.boolean().optional(),
});
export type Run = z.infer<typeof Run>;

/** One schedule as it is kept: what it is, and what it has done. */
export const Entry = z.strictObject({ schedule: Schedule, run: Run });
export type Entry = z.infer<typeof Entry>;

/** Every schedule by name. */
export type Table = Readonly<Record<string, Entry>>;

/** How late a firing may be and still happen, unless the schedule says otherwise. */
export const grace = { rule: "5m", once: "1h" };

const graceOf = (schedule: Schedule, kind: Kind): number =>
	milliseconds(schedule.grace ?? (kind === "once" ? grace.once : grace.rule));

export type Next =
	| { readonly when: Temporal.Instant; readonly kind: Kind }
	| {
			readonly when: null;
			readonly kind: Kind;
			readonly why: "paused" | "done";
	  };

/**
 * When a schedule is next meant to fire. An `every` fires its length after
 * the last run ended, so a new one fires at once. A rule chains from the
 * occurrence that last fired, so a late or slow run never shifts it. An `at`
 * is its instant, once.
 */
export const nextFire = (
	{ schedule, run }: Entry,
	now: Temporal.Instant,
	tz: string,
): Next => {
	const kind = kindOf(schedule);
	if (run.paused === true) return { when: null, kind, why: "paused" };
	if ("every" in schedule) {
		const length = milliseconds(schedule.every);
		return {
			when:
				run.ended === undefined
					? now
					: instant(run.ended).add({ milliseconds: length }),
			kind,
		};
	}
	if ("at" in schedule)
		return run.started !== undefined || run.spent === true
			? { when: null, kind, why: "done" }
			: { when: instant(schedule.at), kind };
	const anchor = {
		start: instant(schedule.from ?? epoch),
		tz: timeZone(schedule.tz ?? tz),
	};
	// With no history, search from the last occurrence before the grace window
	// opened: from the anchor would replay every occurrence since, and from now
	// would skip the one being stood on.
	const from =
		run.due !== undefined
			? instant(run.due)
			: (previousOccurrence(
					schedule.rule,
					anchor,
					now.subtract({ milliseconds: graceOf(schedule, kind) }),
				) ?? anchor.start.subtract({ nanoseconds: 1 }));
	const when = nextOccurrence(schedule.rule, anchor, from);
	return when === null ? { when, kind, why: "done" } : { when, kind };
};

export type Fire = {
	readonly name: string;
	readonly due: Temporal.Instant;
	readonly kind: Kind;
};

/** A firing that won't happen because it is too late: passed over, or for an `at`, spent. */
export type Miss = Fire;

export type Verdict = {
	readonly fire: readonly Fire[];
	readonly miss: readonly Miss[];
	readonly errors: readonly { readonly name: string; readonly error: string }[];
};

type Decision =
	| { readonly kind: "fire"; readonly fire: Fire }
	| { readonly kind: "miss"; readonly miss: Miss }
	| { readonly kind: "error"; readonly error: string }
	| { readonly kind: "wait" };

const decide = (
	name: string,
	entry: Entry,
	now: Temporal.Instant,
	tz: string,
): Decision => {
	try {
		if (entry.run.running === true) return { kind: "wait" };
		const next = nextFire(entry, now, tz);
		if (next.when === null || Temporal.Instant.compare(now, next.when) < 0)
			return { kind: "wait" };
		const late = now.epochMilliseconds - next.when.epochMilliseconds;
		const firing = { name, due: next.when, kind: next.kind };
		const catchUp = "rule" in entry.schedule && entry.schedule.catchUp === true;
		return next.kind === "every" ||
			catchUp ||
			late <= graceOf(entry.schedule, next.kind)
			? { kind: "fire", fire: firing }
			: { kind: "miss", miss: firing };
	} catch (error) {
		return { kind: "error", error: errorMessage(error) };
	}
};

/**
 * The whole decision, for every schedule, at one instant. A schedule never
 * runs twice at once. A firing that came due while nothing was watching
 * happens if it is within its grace, or the rule says to catch up;
 * otherwise it is missed.
 */
export const due = (
	table: Table,
	now: Temporal.Instant,
	tz: string,
): Verdict => {
	const decisions = Object.entries(table).map(([name, entry]) => ({
		name,
		decision: decide(name, entry, now, tz),
	}));
	return {
		fire: decisions.flatMap(({ decision }) =>
			decision.kind === "fire" ? [decision.fire] : [],
		),
		miss: decisions.flatMap(({ decision }) =>
			decision.kind === "miss" ? [decision.miss] : [],
		),
		errors: decisions.flatMap(({ name, decision }) =>
			decision.kind === "error" ? [{ name, error: decision.error }] : [],
		),
	};
};

/** The earliest instant anything is due, so the scheduler can sleep until then. */
export const nextWake = (
	table: Table,
	now: Temporal.Instant,
	tz: string,
): Temporal.Instant | undefined =>
	Object.values(table)
		.flatMap((entry) => {
			if (entry.run.running === true) return [];
			try {
				const next = nextFire(entry, now, tz);
				return next.when === null ? [] : [next.when];
			} catch {
				// A broken schedule is reported by `due`.
				return [];
			}
		})
		.reduce<Temporal.Instant | undefined>(
			(earliest, when) =>
				earliest === undefined || Temporal.Instant.compare(when, earliest) < 0
					? when
					: earliest,
			undefined,
		);
