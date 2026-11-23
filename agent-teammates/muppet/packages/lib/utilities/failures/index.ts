/**
 * Failure logging as a behavior to `use`: it subscribes to `hooks.failed`, so
 * a behavior that uses it may run, and appends every failure to a JSON Lines
 * file in its own state directory. `recentFailures` lets the agent read them.
 *
 *     behavior().use(context).use(failureLog())
 */
import { join } from "node:path";
import { z } from "zod";
import { behavior } from "../../core/behavior.ts";
import { module } from "../../core/capability.ts";
import type { Failure } from "../../core/hook.ts";
import type { Files, StatePaths } from "../../core/state.ts";
import { type Clock, isoText } from "../time/index.ts";

type Context = {
	readonly state: StatePaths;
	readonly files: Files;
	readonly clock: Clock;
};

/** The state directory the log lives in. */
export const owner = "failures";
const fileName = "failures.jsonl";

/**
 * One failure as logged. The event's payload is left out: it may be large,
 * or private.
 */
export const Logged = z.object({
	at: z.string(),
	kind: z.enum(["wake", "handler"]),
	/** The event that was being handled, or that led to the wake. */
	event: z.string(),
	/** For a wake, what the agent was asked to do. */
	request: z.string().optional(),
	error: z.string(),
});
export type Logged = z.infer<typeof Logged>;

const file = ({ state }: Context) => join(state.capability(owner), fileName);

/** The failure as a log entry, at `at`. */
export const entry = (failure: Failure, at: Temporal.Instant): Logged =>
	failure.kind === "wake"
		? {
				at: isoText(at),
				kind: "wake",
				event: failure.wake.event.name,
				request: failure.wake.request,
				error: failure.error,
			}
		: {
				at: isoText(at),
				kind: "handler",
				event: failure.event.name,
				error: failure.error,
			};

/** Every logged failure, oldest first. Lines that don't parse are skipped. */
const read = async (context: Context): Promise<Logged[]> =>
	((await context.files.read(file(context))) ?? "")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				const parsed = Logged.safeParse(JSON.parse(line));
				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});

/**
 * Your `count` most recent failed handlers and wakes, oldest first. Each has
 * when it happened, whether a handler or a wake failed, the event involved,
 * and the error with its stack.
 */
export const recentFailures = async (
	context: Context,
	{ count }: { readonly count: number },
): Promise<Logged[]> => (await read(context)).slice(-count);

export const failures = module({
	name: owner,
	summary: "Read your recent failed handlers and wakes.",
	file: import.meta.path,
	functions: { recentFailures },
});

/**
 * Logs every failure. The hook delivers failures one at a time, so appends
 * never overlap.
 */
export const failureLog = () =>
	behavior<Context>()
		.capability(failures)
		.on(
			(sources) => sources.hooks.failed,
			async (failure, context) => {
				const line = `${JSON.stringify(entry(failure, context.clock.now()))}\n`;
				await context.files.write(
					file(context),
					`${(await context.files.read(file(context))) ?? ""}${line}`,
				);
			},
		);
