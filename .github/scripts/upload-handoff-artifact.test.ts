import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CommandResult,
	receipt,
	retryableFinalizeFailure,
	runCommand,
	uploadHandoff,
} from "./upload-handoff-artifact";

const transient: CommandResult = {
	code: 1,
	stdout: "",
	stderr: "Failed: failed to finalize upload (DeadlineExceeded).\n",
};
const success: CommandResult = {
	code: 0,
	stdout: "Uploaded artifact",
	stderr: "",
};
const destination = "handoff/100-2/example/lambda-artifacts.tar.gz";
function fixture(results: CommandResult[]) {
	const calls: string[][] = [];
	const waits: number[] = [];
	const logs: string[] = [];
	let content = "original";
	const deps = {
		readReceipt: async () => ({ sha256: content, bytes: 8 }),
		run: async (args: string[]) => {
			calls.push(args);
			return results.shift() ?? success;
		},
		wait: async (ms: number) => {
			waits.push(ms);
		},
		log: (line: string) => logs.push(line),
	};
	return {
		deps,
		calls,
		waits,
		logs,
		mutate: () => {
			content = "modified";
		},
	};
}

describe("strict upload failure classifier", () => {
	test("accepts observed diagnostic with official informational footer", () => {
		expect(
			retryableFinalizeFailure({
				...transient,
				stderr: `${transient.stderr}\nThis was unexpected. Please reach out to our team at <support-address> and mention request ID\nsyntheticrequest.\n\nSee https://namespace.so/docs for more help.\nAgents: fetch https://namespace.so/docs/llms.txt. Look up the failing command under the CLI section.\n`,
			}),
		).toBe(true);
		expect(
			retryableFinalizeFailure({
				...transient,
				stderr: `\x1b[31m${transient.stderr}\x1b[0m`,
			}),
		).toBe(true);
	});
	for (const status of [
		"PermissionDenied",
		"Unauthenticated",
		"AlreadyExists",
		"InvalidArgument",
		"Internal",
		"Unavailable",
		"ResourceExhausted",
		"Canceled",
	]) {
		test(`rejects ${status}`, () => {
			expect(
				retryableFinalizeFailure({
					...transient,
					stderr: `Failed: failed to finalize upload (${status}).`,
				}),
			).toBe(false);
			expect(
				retryableFinalizeFailure({
					...transient,
					stderr: `${transient.stderr}Failed: ${status}.`,
				}),
			).toBe(false);
		});
	}
	test("rejects unknown output, other phases, misleading footer, wrong exit, cancellation", () => {
		for (const result of [
			{ ...transient, stderr: `${transient.stderr}unknown diagnostic` },
			{ ...transient, stderr: transient.stderr.replace("finalize", "create") },
			{
				...transient,
				stderr: `${transient.stderr}This was unexpected. PermissionDenied`,
			},
			{ ...transient, stdout: "PermissionDenied" },
			{ ...transient, code: 2 },
			{ ...transient, problem: "cancelled" },
		])
			expect(retryableFinalizeFailure(result)).toBe(false);
	});
});

describe("bounded immutable handoff", () => {
	test("first success retains receipt, destination and expiry", async () => {
		const f = fixture([success]);
		await uploadHandoff(
			"archive.tar.gz",
			destination,
			new AbortController().signal,
			f.deps,
		);
		expect(f.calls).toEqual([
			["artifact", "upload", "archive.tar.gz", destination, "--expires_in=24h"],
		]);
		expect(f.waits).toEqual([]);
		expect(f.logs[0]).toBe("handoff receipt: original (8 bytes)");
	});
	test("ambiguous finalize failure retries exactly the same arguments until actual success", async () => {
		const f = fixture([transient, transient, success]);
		await uploadHandoff(
			"archive.tar.gz",
			destination,
			new AbortController().signal,
			f.deps,
		);
		expect(f.calls).toHaveLength(3);
		expect(f.calls[1]).toEqual(f.calls[0]);
		expect(f.calls[2]).toEqual(f.calls[0]);
		expect(f.waits).toEqual([5000, 10000]);
	});
	test("exhaustion stays failed after three attempts", async () => {
		const f = fixture([transient, transient, transient]);
		await expect(
			uploadHandoff(
				"archive.tar.gz",
				destination,
				new AbortController().signal,
				f.deps,
			),
		).rejects.toThrow("exit 1");
		expect(f.calls).toHaveLength(3);
		expect(f.waits).toEqual([5000, 10000]);
	});
	test("permanent and local process failures never retry", async () => {
		for (const result of [
			{ ...transient, stderr: "Failed: AlreadyExists." },
			{ ...transient, problem: "Upload process deadline exceeded" },
		]) {
			const f = fixture([result]);
			await expect(
				uploadHandoff(
					"archive.tar.gz",
					destination,
					new AbortController().signal,
					f.deps,
				),
			).rejects.toThrow();
			expect(f.calls).toHaveLength(1);
			expect(f.waits).toEqual([]);
		}
	});
	test("same-size changes during backoff prevent the next upload", async () => {
		const f = fixture([transient, success]);
		f.deps.wait = async () => f.mutate();
		await expect(
			uploadHandoff(
				"archive.tar.gz",
				destination,
				new AbortController().signal,
				f.deps,
			),
		).rejects.toThrow("input changed");
		expect(f.calls).toHaveLength(1);
	});
	test("CLI success cannot bypass post-upload integrity", async () => {
		const f = fixture([success]);
		f.deps.run = async (args) => {
			f.calls.push(args);
			f.mutate();
			return success;
		};
		await expect(
			uploadHandoff(
				"archive.tar.gz",
				destination,
				new AbortController().signal,
				f.deps,
			),
		).rejects.toThrow("input changed");
	});
	test("cancellation before upload or during backoff never starts another command", async () => {
		for (const before of [true, false]) {
			const controller = new AbortController();
			const f = fixture([transient, success]);
			if (before) controller.abort();
			f.deps.wait = async () => controller.abort();
			await expect(
				uploadHandoff("archive.tar.gz", destination, controller.signal, f.deps),
			).rejects.toThrow();
			expect(f.calls).toHaveLength(before ? 0 : 1);
		}
	});
});

test("real file receipts detect equal-size mutation and missing files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handoff-test-"));
	try {
		const file = join(dir, "archive");
		await writeFile(file, "first");
		const first = await receipt(file);
		await writeFile(file, "other");
		expect((await receipt(file)).sha256).not.toBe(first.sha256);
		expect((await receipt(file)).bytes).toBe(first.bytes);
		await expect(receipt(join(dir, "missing"))).rejects.toThrow();
		await expect(receipt(dir)).rejects.toThrow("not a file");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("real child lifecycle (synthetic CLI only)", () => {
	test("successful command exits and missing command fails", async () => {
		expect(
			(
				await runCommand(
					process.execPath,
					["-e", "console.log('ok')"],
					2000,
					new AbortController().signal,
				)
			).code,
		).toBe(0);
		expect(
			(
				await runCommand(
					"/nonexistent/handoff-test-command",
					[],
					2000,
					new AbortController().signal,
				)
			).problem,
		).toBe("Upload process could not run");
	});
	test("hung child is killed and reaped before return", async () => {
		const result = await runCommand(
			process.execPath,
			["-e", "console.log(process.pid); setInterval(() => {}, 1000)"],
			200,
			new AbortController().signal,
		);
		expect(result.problem).toBe("Upload process deadline exceeded");
		expect(result.code).not.toBe(0);
		const pid = Number(result.stdout.trim());
		expect(pid).toBeGreaterThan(0);
		expect(() => process.kill(pid, 0)).toThrow();
	});
	test("abort kills and reaps the running child", async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 200);
		try {
			const result = await runCommand(
				process.execPath,
				["-e", "console.log(process.pid); setInterval(() => {}, 1000)"],
				2000,
				controller.signal,
			);
			expect(result.problem).toBe("Upload cancelled");
			expect(() => process.kill(Number(result.stdout.trim()), 0)).toThrow();
		} finally {
			clearTimeout(timer);
		}
	});
	test("unbounded output is stopped and cannot classify as transient", async () => {
		const result = await runCommand(
			process.execPath,
			["-e", "console.error('x'.repeat(100000)); setInterval(() => {}, 1000)"],
			2000,
			new AbortController().signal,
		);
		expect(result.problem).toBe("Upload output exceeded limit");
		expect(retryableFinalizeFailure(result)).toBe(false);
	});
});
