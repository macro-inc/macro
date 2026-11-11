/**
 * Jobs: long-running programs and agents the agent starts and keeps track
 * of, e.g. a coding agent working on a task for an hour. One interface,
 * whatever runs them: `herdrJobs` runs each in a Herdr terminal, which a
 * person can watch and type into, and which takes down everything the job
 * started when it is stopped.
 *
 * A job is found by its name, or by the labels it was started with, never by
 * a process id: whatever runs the jobs knows whether one is running, so the
 * agent never has to.
 *
 *     behavior().use(jobs({ jobs: herdrJobs({ parent: "t60" }) }))
 *       .on((sources) => sources.jobs, async (job, { wake }) => …)
 */
import { z } from "zod";
import { behavior } from "../../core/behavior.ts";
import { module } from "../../core/capability.ts";
import { source } from "../../core/event.ts";

export { herdrJobs } from "./herdr.ts";

/** Where a job is: still going, with what an agent is doing if it is one, or ended, and how. */
export const Status = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("running"),
		/** For an agent, what it is doing, e.g. `working`, `blocked` or `done` (with its turn). Absent for a plain program. */
		activity: z.string().optional(),
	}),
	z.object({
		kind: z.literal("finished"),
		/** Why it ended, e.g. `exited`, `killed`, or `stopped_by_restart` when whatever ran it restarted. */
		reason: z.string(),
		exitCode: z.number().optional(),
		signal: z.number().optional(),
	}),
]);
export type Status = z.infer<typeof Status>;

export const Job = z.object({
	/** Unique among running jobs. */
	name: z.string(),
	/** What it was started with, to find it by. */
	labels: z.record(z.string(), z.string()),
	/** The job it runs under, if any: it is shown beneath it, and ends with it unless it outlives it. */
	parent: z.string().optional(),
	status: Status,
});
export type Job = z.infer<typeof Job>;

/** What to run. */
export type Start = {
	/** Unique among running jobs: lower-case letters, digits, `-` and `_`. */
	readonly name: string;
	/**
	 * The program and its arguments. It runs in the environment of whatever
	 * runs the jobs, not the caller's, so anything it needs it gets here or
	 * finds itself. Never a secret: arguments are visible to every process on
	 * the machine. A job that needs one reads it itself, e.g. from credentials.
	 */
	readonly argv: readonly string[];
	readonly cwd: string;
	readonly labels?: Readonly<Record<string, string>>;
	/** The job it runs under. */
	readonly parent?: string;
	/** Keep running when its parent ends. */
	readonly outliveParent?: boolean;
};

export type Jobs = {
	/** Starts a job and returns it, running. Throws if the name is taken. */
	readonly start: (job: Start) => Promise<Job>;
	/** The job by this name, running or recently finished, or undefined. */
	readonly get: (name: string) => Promise<Job | undefined>;
	/** Every job carrying all of these labels, running or recently finished. */
	readonly list: (
		labels?: Readonly<Record<string, string>>,
	) => Promise<readonly Job[]>;
	/** Ends the job and everything it started. Nothing happens if it has already ended. */
	readonly stop: (name: string) => Promise<void>;
	/** Types text into the job and presses enter, as a person at its terminal would. */
	readonly send: (name: string, text: string) => Promise<void>;
	/** What the job's terminal shows, with this many lines of history above it. */
	readonly read: (name: string, lines: number) => Promise<string>;
	/** Forgets a finished job. */
	readonly forget: (name: string) => Promise<void>;
	/**
	 * Every change to a job carrying all of these labels, as the job now is:
	 * started, its activity changed, or it finished. Nothing is watched until
	 * it is first read.
	 */
	readonly changes: (
		labels?: Readonly<Record<string, string>>,
	) => AsyncIterable<Job>;
};

/** Whether `job` carries every one of `labels`. */
export const carries = (
	job: Pick<Job, "labels">,
	labels: Readonly<Record<string, string>> = {},
): boolean =>
	Object.entries(labels).every(([key, value]) => job.labels[key] === value);

/**
 * Jobs kept in memory, e.g. for tests. Nothing runs: `finish` and `act`
 * stand in for a job ending, or an agent changing what it is doing.
 */
export const memoryJobs = (): Jobs & {
	readonly finish: (
		name: string,
		how: Omit<Extract<Status, { kind: "finished" }>, "kind">,
	) => void;
	readonly act: (name: string, activity: string) => void;
	readonly sent: (name: string) => readonly string[];
} => {
	const jobs = new Map<string, Job>();
	const typed = new Map<string, string[]>();
	const watchers = new Set<(job: Job) => void>();
	const change = (job: Job): void => {
		jobs.set(job.name, job);
		for (const watch of watchers) watch(job);
	};
	const running = (name: string): Job => {
		const job = jobs.get(name);
		if (job === undefined || job.status.kind !== "running")
			throw new Error(`no running job named ${name}`);
		return job;
	};
	return {
		start: async ({ name, labels = {}, parent }) => {
			if (jobs.get(name)?.status.kind === "running")
				throw new Error(`a job named ${name} is already running`);
			const job: Job = {
				name,
				labels: { ...labels },
				...(parent === undefined ? {} : { parent }),
				status: { kind: "running" },
			};
			change(job);
			return job;
		},
		get: async (name) => jobs.get(name),
		list: async (labels) =>
			[...jobs.values()].filter((job) => carries(job, labels)),
		stop: async (name) => {
			const job = jobs.get(name);
			if (job?.status.kind === "running")
				change({ ...job, status: { kind: "finished", reason: "killed" } });
		},
		send: async (name, text) => {
			running(name);
			typed.set(name, [...(typed.get(name) ?? []), text]);
		},
		read: async (name) => (typed.get(name) ?? []).join("\n"),
		forget: async (name) => {
			if (jobs.get(name)?.status.kind === "finished") jobs.delete(name);
		},
		changes: (labels) => ({
			[Symbol.asyncIterator]: () => {
				const waiting: Job[] = [];
				let wake: (() => void) | undefined;
				watchers.add((job) => {
					if (!carries(job, labels)) return;
					waiting.push(job);
					wake?.();
				});
				return {
					next: async () => {
						while (waiting.length === 0)
							await new Promise<void>((resolve) => {
								wake = resolve;
							});
						const [value] = waiting.splice(0, 1);
						if (value === undefined) throw new Error("a change was lost");
						return { done: false, value };
					},
				};
			},
		}),
		finish: (name, how) =>
			change({ ...running(name), status: { kind: "finished", ...how } }),
		act: (name, activity) =>
			change({ ...running(name), status: { kind: "running", activity } }),
		sent: (name) => typed.get(name) ?? [],
	};
};

type Context = { readonly jobs: Jobs };

/** Your jobs, running or recently finished, with what each is doing. With `labels`, only the jobs carrying all of them. */
export const listJobs = (
	{ jobs }: Context,
	{ labels }: { readonly labels?: Readonly<Record<string, string>> } = {},
): Promise<readonly Job[]> => jobs.list(labels);

const shown = 80;

/** What a job's terminal shows, to see what it is doing, with `lines` of history above the screen. */
export const readJob = (
	{ jobs }: Context,
	{ name, lines = shown }: { readonly name: string; readonly lines?: number },
): Promise<string> => jobs.read(name, lines);

/** Types a line into a running job, as a person at its terminal would. */
export const sendToJob = async (
	{ jobs }: Context,
	{ name, text }: { readonly name: string; readonly text: string },
): Promise<void> => {
	if (text === "") throw new Error("nothing to send");
	await jobs.send(name, text);
};

/** Stops a job, and everything it started. */
export const stopJob = (
	{ jobs }: Context,
	{ name }: { readonly name: string },
): Promise<void> => jobs.stop(name);

export const jobControl = module({
	name: "jobs",
	summary: "List, read, talk to and stop your jobs.",
	file: import.meta.path,
	functions: { listJobs, readJob, sendToJob, stopJob },
});

/**
 * Jobs as a behavior to `use`: `jobs` in the context, a `jobs` source of
 * every change to a job carrying `labels`, and capabilities to list, read,
 * talk to and stop them. Starting a job is the agent's own code's to do, with
 * `context.jobs.start`, since what a job runs is particular to the agent.
 */
export const jobs = ({
	jobs,
	labels,
}: {
	readonly jobs: Jobs;
	/** Only changes to jobs carrying these labels reach the source, e.g. the agent's own. */
	readonly labels?: Readonly<Record<string, string>>;
}) =>
	behavior()
		.decorate({ jobs })
		.source({ jobs: source(jobs.changes(labels)) })
		.capability(jobControl);
