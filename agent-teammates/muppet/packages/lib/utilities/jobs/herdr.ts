import { z } from "zod";
import type { Job, Jobs, Status } from "./index.ts";

/**
 * Jobs as Herdr terminals, through herdr-core's `hc`. Each job is a terminal a
 * person can watch in Herdr's sidebar and type into, nested under its parent.
 * Herdr runs each terminal in a cgroup of its own, so stopping a job takes
 * down everything it started, daemons included, and Herdr, not the agent,
 * knows whether a job is running.
 *
 * Every job this starts carries the label `owner`, and only jobs carrying it
 * are listed or watched, so the agent never sees, or stops, terminals that
 * aren't its own.
 *
 * Restarting Herdr's server stops every terminal: their jobs finish with the
 * reason `stopped_by_restart`. A job whose work must survive that has to be
 * able to start again.
 *
 * It needs herdr-core's `hc` on the system.
 */
export const herdrJobs = ({
	owner,
	parent,
	hc = "hc",
	exec = spawn,
	follow = lines,
	retryMs = 5_000,
}: {
	/** Who the jobs belong to: the value of their `job-owner` label, e.g. the agent's name. */
	readonly owner: string;
	/** The terminal jobs run under when they don't name a parent, e.g. a person's session. */
	readonly parent?: string;
	/** The hc program. */
	readonly hc?: string;
	/** Runs a program to the end, e.g. for tests. */
	readonly exec?: Exec;
	/** Runs a program that never ends, and yields each line it prints, e.g. for tests. */
	readonly follow?: Follow;
	/** How long to wait before following Herdr's events again when they stop. */
	readonly retryMs?: number;
}): Jobs => {
	const mine = { [ownerLabel]: owner };
	const labelArgs = (labels: Readonly<Record<string, string>>) =>
		Object.entries({ ...labels, ...mine }).flatMap(([key, value]) => [
			"--label",
			`${key}=${value}`,
		]);

	/** Runs hc: its JSON, or what it said went wrong, e.g. `not_found`. Throws if it failed without saying. */
	const ask = async (args: readonly string[]): Promise<Answer> => {
		const { code, stdout, stderr } = await exec([hc, ...args, "--json"]);
		const parsed = parseJson(stdout);
		// hc reports what went wrong as JSON on stderr.
		const failed = Failed.safeParse(parseJson(stderr.trim()) ?? parsed);
		if (failed.success) return { kind: "failed", ...failed.data.error };
		if (code !== 0)
			throw new Error(
				`hc ${args[0]} exited ${code}: ${stderr.trim().slice(0, 500)}`,
			);
		return { kind: "ok", value: parsed };
	};

	/** Runs hc, and throws with what it said if it failed. */
	const call = async (args: readonly string[]): Promise<unknown> => {
		const answer = await ask(args);
		if (answer.kind === "failed") throw new Error(`hc: ${answer.message}`);
		return answer.value;
	};

	const get = async (name: string): Promise<Job | undefined> => {
		const answer = await ask(["get", name]);
		if (answer.kind === "failed") {
			if (answer.errorKind === notFound) return undefined;
			throw new Error(`hc: ${answer.message}`);
		}
		const terminal = Terminal.parse(answer.value);
		return terminal.labels?.[ownerLabel] === owner ? job(terminal) : undefined;
	};

	/** The job, or a throw if it isn't this owner's: nothing here touches anyone else's terminal. */
	const own = async (name: string): Promise<Job> => {
		const found = await get(name);
		if (found === undefined) throw new Error(`no job named ${name}`);
		return found;
	};

	return {
		start: async ({
			name,
			argv,
			cwd,
			labels = {},
			parent: under,
			outliveParent,
		}) => {
			const parentArgs =
				(under ?? parent) === undefined
					? ["--no-parent"]
					: ["--parent", under ?? parent ?? ""];
			await call([
				"run",
				"--bg",
				"--no-notify",
				"--name",
				name,
				"--cwd",
				cwd,
				...labelArgs(labels),
				...parentArgs,
				...(outliveParent === true ? ["--outlive-parent"] : []),
				// Everything after this is the job's own argv, whatever it looks like.
				"--",
				...argv,
			]);
			return own(name);
		},
		get,
		list: async (labels = {}) => {
			const listed = Listing.parse(
				await call(["ls", "--all", ...labelArgs(labels)]),
			);
			// The listing leaves labels out, so each is read whole.
			const found = await Promise.all(
				listed.terminals.map(({ address }) => get(address)),
			);
			return found.flatMap((one) => (one === undefined ? [] : [one]));
		},
		stop: async (name) => {
			const found = await own(name);
			if (found.status.kind === "running") await call(["kill", name]);
		},
		send: async (name, text) => {
			await own(name);
			await call(["send", name, text]);
		},
		read: async (name, lines) => {
			await own(name);
			const { code, stdout, stderr } = await exec([
				hc,
				"read",
				name,
				"--lines",
				String(lines),
			]);
			if (code !== 0)
				throw new Error(
					`hc read exited ${code}: ${stderr.trim().slice(0, 500)}`,
				);
			return stdout;
		},
		forget: async (name) => {
			const found = await own(name);
			if (found.status.kind === "finished") await call(["rm", name]);
		},
		changes: (labels = {}) => ({
			[Symbol.asyncIterator]: async function* () {
				// Herdr sends several events for one change, e.g. a start; each job is yielded only when it differs.
				const last = new Map<string, string>();
				for (;;) {
					try {
						for await (const line of follow([
							hc,
							"events",
							"--json",
							...labelArgs(labels),
						])) {
							const event = Event.safeParse(parseJson(line));
							// The first line is a snapshot of how things are; changes come after.
							if (!event.success) continue;
							const changed = await get(event.data.params.terminal);
							if (changed === undefined) continue;
							const seen = JSON.stringify(changed);
							if (last.get(changed.name) === seen) continue;
							last.set(changed.name, seen);
							yield changed;
						}
					} catch {
						// Herdr went away, or its events stopped: follow them again below.
					}
					await new Promise((resolve) => setTimeout(resolve, retryMs));
				}
			},
		}),
	};
};

/** The label every job of one owner carries. */
export const ownerLabel = "job-owner";

const notFound = "not_found";

/** Runs a program to the end. */
export type Exec = (argv: readonly string[]) => Promise<{
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}>;

/** Runs a program that doesn't end, and yields each line it prints. */
export type Follow = (argv: readonly string[]) => AsyncIterable<string>;

/** What hc said went wrong. */
const Failed = z.object({
	error: z
		.object({ kind: z.string(), message: z.string() })
		.transform(({ kind, message }) => ({ errorKind: kind, message })),
});

/** What hc answered: its JSON, or the failure it reported. */
type Answer =
	| { readonly kind: "ok"; readonly value: unknown }
	| {
			readonly kind: "failed";
			readonly errorKind: string;
			readonly message: string;
	  };

/**
 * A terminal as hc describes it. An agent's status is a word in a listing and
 * an object in a terminal's own record.
 */
export const Terminal = z.object({
	address: z.string(),
	name: z.string().nullish(),
	state: z.enum(["live", "finished"]),
	status: z
		.union([z.string(), z.object({ state: z.string() }).loose()])
		.nullish(),
	reason: z.string().nullish(),
	exit_code: z.number().nullish(),
	signal: z.number().nullish(),
	parent: z.string().nullish(),
	labels: z.record(z.string(), z.string()).nullish(),
});
export type Terminal = z.infer<typeof Terminal>;

const Listing = z.object({
	terminals: z.array(Terminal.pick({ address: true })),
});

const Event = z.object({
	method: z.literal("event"),
	params: z.object({ terminal: z.string() }),
});

/** A terminal as a job. */
export const job = (terminal: Terminal): Job => {
	const { status } = terminal;
	const activity = typeof status === "string" ? status : status?.state;
	const ended: Status = {
		kind: "finished",
		reason: terminal.reason ?? "unknown",
		...(terminal.exit_code == null ? {} : { exitCode: terminal.exit_code }),
		...(terminal.signal == null ? {} : { signal: terminal.signal }),
	};
	return {
		name: terminal.name ?? terminal.address,
		labels: Object.fromEntries(
			Object.entries(terminal.labels ?? {}).filter(
				([key]) => key !== ownerLabel,
			),
		),
		...(terminal.parent == null ? {} : { parent: terminal.parent }),
		status:
			terminal.state === "live"
				? { kind: "running", ...(activity == null ? {} : { activity }) }
				: ended,
	};
};

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

const spawn: Exec = async (argv) => {
	const child = Bun.spawn([...argv], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
};

async function* lines(argv: readonly string[]): AsyncIterable<string> {
	const child = Bun.spawn([...argv], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const decoder = new TextDecoder();
	let pending = "";
	try {
		for await (const chunk of child.stdout) {
			pending += decoder.decode(chunk, { stream: true });
			const complete = pending.split("\n");
			pending = complete.pop() ?? "";
			yield* complete.filter((line) => line.trim() !== "");
		}
	} finally {
		child.kill();
	}
}
