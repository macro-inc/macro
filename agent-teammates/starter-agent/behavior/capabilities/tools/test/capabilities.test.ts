import { expect, test } from "bun:test";
import { invoke } from "../../../../test/invoke.ts";
import { memoryCredentials } from "../../../context/credentials.ts";
import { log as makeLog } from "../../../context/log.ts";
import type { Ran, RunOptions, Started } from "../../../context/shell.ts";
import { fixedClock, join, memoryDisk } from "../../../context/test/fakes.ts";
import { listCredentials, toolsModule, useCredential } from "../index.ts";

type Call = { readonly argv: readonly string[]; readonly options: RunOptions };

/** As much of the context as these capabilities read, with a shell that records what it was asked to run. */
const rig = (
	answer: (argv: readonly string[]) => Partial<Ran> = () => ({}),
) => {
	const calls: Call[] = [];
	const disk = memoryDisk();
	const credentials = memoryCredentials({
		EXAMPLE_PASSWORD: "hunter2hunter2hunter2",
		EXAMPLE_TOTP_SECRET: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
		EXAMPLE_API_KEY: "example-key-0123456789",
	});
	const clock = fixedClock("2026-11-03T12:00:00Z");
	const context = {
		tools: { commandTimeoutMs: 3_000 },
		clock,
		credentials,
		random: {
			bytes: (count: number) => new Uint8Array(count).fill(65),
		},
		shell: {
			run: async (argv: readonly string[], options: RunOptions = {}) => {
				calls.push({ argv, options });
				return { code: 0, stdout: "", stderr: "", ...answer(argv) };
			},
			start: (): Started => {
				throw new Error("nothing here starts a process");
			},
			alive: () => false,
		},
		log: makeLog({ directory: "/t/state/log/agent", join, disk, clock }),
	};
	/** Everything the capabilities logged. */
	const events = () =>
		[...disk.files.entries()]
			.filter(([path]) => path.startsWith("/t/state/log/agent/"))
			.map(([, text]) => text)
			.join("");
	return { context, calls, events, disk, credentials };
};

test("setCredential generates, takes a program's output, and stores nothing when either is wrong", async () => {
	const { context, credentials, events } = rig((argv) =>
		argv[0] === "fails"
			? { code: 1, stdout: "sk-ignored-0123456789" }
			: argv[0] === "empty"
				? { stdout: "\n" }
				: { stdout: '"sk-from-the-page-0123456789"\n' },
	);
	const set = (input: unknown) =>
		invoke(toolsModule, "setCredential", context, input);

	expect(await set({ name: "NEW_PASSWORD", generate: true })).toEqual({
		kind: "succeeded",
		output: { name: "NEW_PASSWORD", length: 32 },
	});
	expect((await credentials.get("NEW_PASSWORD")).length).toBe(32);

	const stored = await set({
		name: "OTHER_API_KEY",
		fromCommand: ["print-key"],
	});
	expect(stored.kind).toBe("succeeded");
	expect(await credentials.get("OTHER_API_KEY")).toBe(
		"sk-from-the-page-0123456789",
	);
	// Nothing that is returned or logged holds a value.
	expect(JSON.stringify([stored, events()])).not.toContain("sk-from-the-page");

	for (const input of [
		{ name: "A_KEY", fromCommand: ["fails"] },
		{ name: "A_KEY", fromCommand: ["empty"] },
		{ name: "A_KEY", value: "short" },
		{ name: "A_KEY", value: "has some whitespace in it" },
		{ name: "A_KEY" },
		{ name: "A_KEY", generate: true, value: "x".repeat(20) },
		{ name: "a-key", generate: true },
	])
		expect((await set(input)).kind).toBe("failed");
	expect(await credentials.has("A_KEY")).toBe(false);
	expect(await credentials.has("a-key")).toBe(false);
});

test("listCredentials and hasCredential give names, never values", async () => {
	const { context } = rig();
	expect(await listCredentials(context)).toEqual([
		"EXAMPLE_API_KEY",
		"EXAMPLE_PASSWORD",
		"EXAMPLE_TOTP_SECRET",
	]);
	expect(
		await invoke(toolsModule, "hasCredential", context, {
			name: "EXAMPLE_API_KEY",
		}),
	).toEqual({ kind: "succeeded", output: true });
	expect(
		await invoke(toolsModule, "hasCredential", context, { name: "MISSING" }),
	).toEqual({ kind: "succeeded", output: false });
});

test("useCredential hands the value over on stdin or in the environment, never in arguments or output", async () => {
	const { context, calls } = rig(() => ({
		stdout: "typed hunter2hunter2hunter2",
		stderr: "echo hunter2hunter2hunter2",
	}));
	const typed = await useCredential(context, {
		argv: ["login", "-"],
		stdin: { credential: "EXAMPLE_PASSWORD" },
		env: { API_KEY: "EXAMPLE_API_KEY" },
	});
	expect(typed).toEqual({
		code: 0,
		stdout: "typed [redacted]",
		stderr: "echo [redacted]",
	});
	expect(calls[0]?.options.stdin).toBe("hunter2hunter2hunter2");
	expect(calls[0]?.options.env).toEqual({ API_KEY: "example-key-0123456789" });
	expect(JSON.stringify(calls[0]?.argv)).not.toContain("hunter2");

	// As a TOTP secret, the code is what is typed: 2026-11-03T12:00:00Z is not one of the RFC's instants, so only its shape is checked.
	await useCredential(context, {
		argv: ["login", "-"],
		stdin: { credential: "EXAMPLE_TOTP_SECRET", as: "totp" },
	});
	expect(calls[1]?.options.stdin).toMatch(/^\d{6}$/);

	expect(
		(
			await invoke(toolsModule, "useCredential", context, {
				argv: ["true"],
				stdin: { credential: "MISSING" },
			})
		).kind,
	).toBe("failed");
	expect(calls).toHaveLength(2);
});
