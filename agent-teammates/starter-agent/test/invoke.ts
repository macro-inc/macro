/**
 * Calls a capability's function in a test the way `bin/agent <function>
 * '<json>'` does: the raw input is written into a one-line script, which is
 * type-checked before it runs. So a test can show that input a function
 * doesn't take never reaches it, without the function checking anything.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Module } from "@muppet/lib/core/capability";
import { describeError } from "@muppet/lib/core/error";
import { checker } from "@muppet/lib/utilities/scripts";
import typescript from "typescript";
import { z } from "zod";

const root = join(import.meta.dir, "..");
const tsconfigFile = "tsconfig.json";
const scriptsDirectory = ".scripts-test";

const check = checker({ typescript, config: join(root, tsconfigFile) });

// The first check reads all of the agent's code, which takes seconds, and longer on
// a busy machine. It is paid here, while the test file loads, so that no
// test's own time limit has to cover it.
const behaviorFile = join(root, "behavior", "index.ts");
check.check({
	[join(root, scriptsDirectory, "warm.ts")]:
		`import type { Script } from ${JSON.stringify(behaviorFile)};\nexport type Warm = Script;`,
});

export type Invoked =
	| { readonly kind: "succeeded"; readonly output: unknown }
	/** The input was refused: by the function's types, or by a schema a function fed by another program parses it with. */
	| { readonly kind: "invalid"; readonly error: string }
	/** The function threw. */
	| { readonly kind: "failed"; readonly error: string };

/** The script that calls `name` with a context of whatever type it takes, and `raw` as its input. */
const calling = (file: string, name: string, raw: unknown): string =>
	[
		`import { ${name} as called } from ${JSON.stringify(file)};`,
		"",
		`export const main = (context: Parameters<typeof called>[0]) => called(context${raw === undefined ? "" : `, ${JSON.stringify(raw)}`});`,
	].join("\n");

export const invoke = async (
	module: Module,
	name: string,
	context: unknown,
	raw?: unknown,
): Promise<Invoked> => {
	const path = join(root, scriptsDirectory, `${crypto.randomUUID()}.ts`);
	const source = calling(module.file, name, raw);
	const errors = check.check({ [path]: source });
	if (errors !== undefined) return { kind: "invalid", error: errors };
	await Bun.write(path, source);
	try {
		const script: unknown = await import(path);
		if (
			typeof script !== "object" ||
			script === null ||
			!("main" in script) ||
			typeof script.main !== "function"
		)
			return { kind: "failed", error: "the script has no main" };
		const output: unknown = await script.main(context);
		return { kind: "succeeded", output };
	} catch (error) {
		return error instanceof z.ZodError
			? { kind: "invalid", error: error.message }
			: { kind: "failed", error: describeError(error) };
	} finally {
		await rm(path, { force: true });
	}
};
