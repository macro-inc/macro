import { z } from "zod";
import type { Credentials } from "./index.ts";

const Secrets = z.record(z.string(), z.string());

/**
 * Credentials in one JSON file encrypted with SOPS, e.g. to an age key. The
 * file can be committed; the key that opens it stays on the machine the agent
 * runs on. It is decrypted into memory once, and again after a `set`. Values
 * go to sops on stdin, so they never appear in a process's arguments.
 *
 * It needs sops (and age, for age keys) on the system: add this directory's
 * flake to the agent's flake, as its comment shows.
 */
export const sopsCredentials = ({
	file,
	sops = "sops",
	env,
}: {
	/** The encrypted file. */
	readonly file: string;
	/** The sops program. */
	readonly sops?: string;
	/** Extra environment for sops, e.g. SOPS_AGE_KEY_FILE. */
	readonly env?: Readonly<Record<string, string>>;
}): Credentials => {
	/** Runs sops, and returns its output, or throws with its error. */
	const run = async (
		args: readonly string[],
		stdin?: string,
	): Promise<string> => {
		const child = Bun.spawn([sops, ...args], {
			stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0)
			throw new Error(`sops exited ${code}: ${stderr.trim().slice(0, 500)}`);
		return stdout;
	};

	const decrypt = async (): Promise<Readonly<Record<string, string>>> =>
		Secrets.parse(
			JSON.parse(await run(["decrypt", "--output-type", "json", file])),
		);
	let secrets: Promise<Readonly<Record<string, string>>> | undefined;
	const all = () => {
		secrets ??= decrypt().catch((error: unknown) => {
			secrets = undefined;
			throw error;
		});
		return secrets;
	};
	return {
		get: async (name) => {
			const value = (await all())[name];
			if (value === undefined || value === "")
				throw new Error(`no credential named ${name} in ${file}`);
			return value;
		},
		has: async (name) => ((await all())[name] ?? "") !== "",
		set: async (name, value) => {
			await run(
				["set", "--value-stdin", file, JSON.stringify([name])],
				JSON.stringify(value),
			);
			secrets = undefined;
		},
		names: async () => Object.keys(await all()).sort(),
	};
};
