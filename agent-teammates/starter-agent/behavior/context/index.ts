/**
 * The agent's context: the one place the outside world is touched.
 * Everything else in its behavior is given these and does no IO of its own, so it can
 * be run against a fake disk, clock, shell or Macro.
 */
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Macro } from "@macro-inc/sdk";
import type { Clock } from "@muppet/lib/utilities/time";
import { type Config, config as makeConfig, settingsFile } from "./config.ts";
import type { Credentials } from "./credentials.ts";
import type { Disk } from "./disk.ts";
import { agentEnvironment } from "./identity.ts";
import { type Log, log as makeLog } from "./log.ts";
import { parseSettings } from "./settings.ts";
import type { Shell } from "./shell.ts";
import { timedOut } from "./shell.ts";
import { sopsCredentials } from "./sops.ts";
import { type State, state as makeState } from "./state.ts";

/** The credential holding the key of the agent's own Macro account. */
export const macroKey = "MACRO_API_KEY";

export type Base = {
	readonly config: Config;
	readonly state: State;
	readonly disk: Disk;
	/** The same disk, under the name lib's utilities ask for. */
	readonly files: Disk;
	readonly clock: Clock;
	readonly shell: Shell;
	readonly credentials: Credentials;
	readonly log: Log;
	/** Joins path parts. Injected so nothing else imports a path library. */
	readonly join: (...parts: readonly string[]) => string;
	/** The agent in Macro, as its own account. Connects on first use. */
	readonly macro: () => Promise<Macro>;
	/** The environment that makes a child process act as the agent. */
	readonly environment: () => Promise<
		Readonly<Record<string, string | undefined>>
	>;
};

const missing = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === "ENOENT";

const orMissing =
	<Value>(fallback: Value) =>
	(error: unknown): Value => {
		if (missing(error)) return fallback;
		throw error;
	};

export const disk: Disk = {
	read: (path) => readFile(path, "utf8").catch(orMissing(undefined)),
	// To a temporary file and renamed, so a reader never sees half of one.
	write: async (path, text) => {
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${crypto.randomUUID()}.tmp`;
		await writeFile(temporary, text);
		await rename(temporary, path);
	},
	append: async (path, text) => {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, text);
	},
	remove: (path) => rm(path, { recursive: true, force: true }),
	rename: (from, to) =>
		mkdir(dirname(to), { recursive: true })
			.then(() => rename(from, to))
			.then(() => true)
			.catch(orMissing(false)),
	list: async (directory) =>
		(await readdir(directory).catch(orMissing<string[]>([]))).sort(),
	exists: (path) =>
		stat(path)
			.then(() => true)
			.catch(orMissing(false)),
	modified: (path) =>
		stat(path)
			.then((stats) =>
				Temporal.Instant.fromEpochMilliseconds(Math.round(stats.mtimeMs)),
			)
			.catch(orMissing(undefined)),
	makeDirectory: async (path) => {
		await mkdir(path, { recursive: true });
	},
};

export const clock: Clock = {
	now: () => Temporal.Now.instant(),
	sleep: (milliseconds) => Bun.sleep(milliseconds),
};

const environmentWith = (
	overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> => ({ ...process.env, ...overrides });

export const shell: Shell = {
	run: async (argv, options = {}) => {
		const child = Bun.spawn([...argv], {
			cwd: options.cwd,
			env: environmentWith(options.env),
			stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
			stdout: "pipe",
			stderr: "pipe",
		});
		let late = false;
		const timer =
			options.timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						late = true;
						child.kill("SIGKILL");
					}, options.timeoutMs);
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		clearTimeout(timer);
		return { code: late ? timedOut : code, stdout, stderr };
	},
	start: (argv, options = {}) => {
		const out = options.log === undefined ? "ignore" : Bun.file(options.log);
		const child = Bun.spawn([...argv], {
			cwd: options.cwd,
			env: environmentWith(options.env),
			stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
			stdout: out,
			stderr: out,
			detached: options.detached,
		});
		if (options.detached) child.unref();
		return {
			pid: child.pid,
			exited: child.exited,
			kill: () => child.kill("SIGTERM"),
		};
	},
	alive: (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	},
};

const logOwner = "agent";

/** Builds the real context for the agent whose repository is at `root`. */
export const base = ({ root }: { readonly root: string }): Base => {
	// The settings are read once, as the process starts: a change takes a restart.
	const file = join(root, settingsFile);
	const text = (() => {
		try {
			return readFileSync(file, "utf8");
		} catch {
			return undefined;
		}
	})();
	const config = makeConfig({
		root,
		home: homedir(),
		join,
		settings: parseSettings(text, file),
	});
	const state = makeState({ root, join });
	const credentials = sopsCredentials({
		file: config.secrets,
		sops: config.sops,
		shell,
	});
	let macro: Promise<Macro> | undefined;
	return {
		config,
		state,
		disk,
		files: disk,
		clock,
		shell,
		credentials,
		join,
		log: makeLog({ directory: state.log(logOwner), join, disk, clock }),
		macro: () => {
			macro ??= credentials
				.get(macroKey)
				.then((apiKey) => new Macro({ auth: { type: "user", apiKey } }));
			return macro;
		},
		environment: () => agentEnvironment({ config, credentials }),
	};
};
