import {
	type Catalog,
	describe,
	type Signatures,
	summarize,
} from "./capability.ts";
import { describeError } from "./error.ts";

/** Records a line for the agent to read with the script's result. */
export type Log = (...values: readonly unknown[]) => void;

/**
 * What a script's `main` is given. A script is an ordinary module: it
 * imports the functions it uses and passes them the context.
 *
 *     export const main = async ({ context, log }: Script<Context>) => ...
 */
export type Script<Context> = {
	readonly context: Context;
	readonly log: Log;
};

/** Where something is exported from: a file, and the name it has there. */
export type Exported = { readonly file: string; readonly name: string };

/**
 * A script that calls one exported function with the context and `input`,
 * which is written into it as JSON, or with the context alone if there is no
 * input. It is how a function is called from outside a script, e.g. from a
 * command line: the input is type-checked like any other script's.
 */
export const calling = (
	script: Exported,
	called: Exported,
	input?: unknown,
): string =>
	[
		`import type { ${script.name} as Script } from ${JSON.stringify(script.file)};`,
		`import { ${called.name} as called } from ${JSON.stringify(called.file)};`,
		"",
		`export const main = ({ context }: Script) => called(context${input === undefined ? "" : `, ${JSON.stringify(input)}`});`,
	].join("\n");

/** What running an agent-written module produced. `logs` is everything it passed to `log`. */
export type Executed =
	| {
			readonly kind: "succeeded";
			readonly output: unknown;
			readonly logs: string;
	  }
	| { readonly kind: "failed"; readonly error: string; readonly logs: string };

/**
 * Runs an agent-written module exporting `async main({ context, log })`
 * with the agent's context, and returns what `main` returned.
 */
export type Execute = (source: string) => Promise<Executed>;

/** A script's module, or the type errors that kept it from being loaded. */
export type Loaded =
	| { readonly kind: "loaded"; readonly module: unknown }
	| { readonly kind: "rejected"; readonly errors: string };

/**
 * Type-checks a script's source and turns it into its module, e.g. by
 * writing it to a file and importing it. Every call must load the source
 * afresh. Nothing else checks what a script passes to the functions it
 * calls, so a `Load` that doesn't check lets anything through.
 */
export type Load = (source: string) => Promise<Loaded>;

/** How the agent uses its capabilities: by writing code. */
export type CodeMode = {
	/** One line per capability; the agent always has this. */
	readonly catalog: string;
	/** The agent's own `Script` type, which every script annotates `main` with. */
	readonly script: Exported;
	/** Full docs for the named capabilities. */
	readonly describe: (names: readonly string[]) => Promise<string>;
	readonly execute: Execute;
};

const noMain = "the script must export `async function main({ context, log })`";

/**
 * Runs scripts in this process, against the same context the handlers use.
 * A script that never returns is never stopped.
 */
export const execute =
	<Context>(context: Context, load: Load): Execute =>
	async (source) => {
		const lines: string[] = [];
		const log: Log = (...values) => {
			lines.push(
				values
					.map((value) =>
						typeof value === "string" ? value : JSON.stringify(value),
					)
					.join(" "),
			);
		};
		const logs = () => lines.join("\n");

		try {
			const loaded = await load(source);
			if (loaded.kind === "rejected")
				return {
					kind: "failed",
					error: `the script doesn't type-check, so it wasn't run:\n${loaded.errors}`,
					logs: logs(),
				};
			const { module } = loaded;
			if (
				typeof module !== "object" ||
				module === null ||
				!("main" in module) ||
				typeof module.main !== "function"
			)
				return { kind: "failed", error: noMain, logs: logs() };
			const script: Script<Context> = { context, log };
			const output: unknown = await module.main(script);
			return { kind: "succeeded", output, logs: logs() };
		} catch (error) {
			return { kind: "failed", error: describeError(error), logs: logs() };
		}
	};

export const codeMode = <Context>(
	catalog: Catalog,
	context: Context,
	{
		load,
		signatures,
		script,
	}: {
		readonly load: Load;
		readonly signatures: Signatures;
		readonly script: Exported;
	},
): CodeMode => ({
	catalog: summarize(catalog),
	script,
	describe: (names) => describe(catalog, names, signatures),
	execute: execute(context, load),
});
