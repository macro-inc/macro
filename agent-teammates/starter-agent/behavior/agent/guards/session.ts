/** What several guards ask of a session or of a command: who it runs as, and what git acts on. */
import type { ToolCall } from "../guard.ts";
import { sessionMarker } from "../../context/identity.ts";
import { basename, here, resolve } from "./path.ts";
import { type Command, expand } from "./shell.ts";

export type Environment = ToolCall["environment"];

/**
 * The agent's process, with or without a working identity: every
 * environment it gives its children carries the marker
 * (behavior/context/identity.ts).
 */
export const isAgentSession = (environment: Environment): boolean =>
	Boolean(environment[sessionMarker]);

/** Does this command give gh a token of its own, and so not use the machine's login? */
export const setsToken = (command: Command): boolean =>
	Object.hasOwn(command.env, "GH_TOKEN") ||
	(command.argv[0] === "export" &&
		command.argv.some((word) => word.startsWith("GH_TOKEN=")));

/** Where a command runs: the session's directory, moved by any `cd` earlier in the same string. */
export const directoryOf = (
	command: Command,
	{ cwd, environment }: Pick<ToolCall, "cwd" | "environment">,
): string =>
	command.cwd === undefined
		? cwd
		: resolve(cwd, expand(command.cwd, environment));

/** Git's subcommand and what follows, past its global flags, and the folder it acts on. */
export const gitParts = (
	command: Command,
	call: Pick<ToolCall, "cwd" | "environment">,
): { readonly args: readonly string[]; readonly directory: string } => {
	const at = (path: string, from: string): string =>
		resolve(from, expand(path, call.environment));
	const start = directoryOf(command, call);
	let directory = command.env.GIT_DIR ? at(command.env.GIT_DIR, start) : start;
	const rest = command.argv.slice(1);
	let index = 0;
	for (;;) {
		const flag = rest[index];
		if (flag === undefined || !flag.startsWith("-")) break;
		if (flag === "-C" || flag === "--git-dir" || flag === "--work-tree") {
			directory = at(rest[index + 1] ?? here, directory);
			index += 2;
		} else if (
			flag.startsWith("--git-dir=") ||
			flag.startsWith("--work-tree=")
		) {
			directory = at(flag.slice(flag.indexOf("=") + 1), directory);
			index += 1;
		} else if (
			flag === "-c" ||
			flag === "--namespace" ||
			flag === "--exec-path" ||
			flag === "--config-env"
		)
			index += 2;
		else index += 1;
	}
	return { args: rest.slice(index), directory };
};

/** `sed -i`, which rewrites the files it names. */
export const editsInPlace = (command: Command): boolean =>
	basename(command.argv[0] ?? "") === "sed" &&
	command.argv.some(
		(word) => /^-[a-zA-Z]*i/.test(word) || word.startsWith("--in-place"),
	);
