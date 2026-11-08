import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

const ATTEMPTS = 3;
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_LIMIT = 64 * 1024;

type Receipt = { sha256: string; bytes: number };
export type CommandResult = {
	code: number | null;
	stdout: string;
	stderr: string;
	problem?: string;
};

/** Only the observed finalization timeout; unknown or mixed diagnostics fail closed. */
export function retryableFinalizeFailure(result: CommandResult): boolean {
	if (result.code !== 1 || result.problem || result.stdout.trim()) return false;
	const lines = stripVTControlCharacters(result.stderr)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.shift() !== "Failed: failed to finalize upload (DeadlineExceeded).")
		return false;
	// These are the CLI's informational footer, never instructions to execute.
	if (lines[0]?.startsWith("This was unexpected.")) {
		if (
			!/^This was unexpected\. Please reach out to our team at \S+ and mention request ID$/.test(
				lines.shift() ?? "",
			) ||
			!/^[a-z0-9]+\.$/.test(lines.shift() ?? "")
		)
			return false;
	}
	if (lines[0] === "See https://namespace.so/docs for more help.")
		lines.shift();
	if (
		lines[0] ===
		"Agents: fetch https://namespace.so/docs/llms.txt. Look up the failing command under the CLI section."
	)
		lines.shift();
	return lines.length === 0;
}

export async function receipt(file: string): Promise<Receipt> {
	if (!(await stat(file)).isFile())
		throw new Error("Handoff input is not a file");
	const hash = createHash("sha256");
	let bytes = 0;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		bytes += chunk.length;
	}
	return { sha256: hash.digest("hex"), bytes };
}

/** No shell; always reap the CLI before returning, including cancellation/timeout. */
export function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
	signal: AbortSignal,
): Promise<CommandResult> {
	signal.throwIfAborted();
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		let problem: string | undefined;
		const stop = (reason: string) => {
			problem ??= reason;
			child.kill("SIGKILL");
		};
		const abort = () => stop("Upload cancelled");
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		const timer = setTimeout(
			() => stop("Upload process deadline exceeded"),
			timeoutMs,
		);
		const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
			outputBytes += chunk.length;
			if (outputBytes > OUTPUT_LIMIT) {
				stop("Upload output exceeded limit");
				return;
			}
			if (stream === "stdout") stdout += chunk.toString();
			else stderr += chunk.toString();
		};
		child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
		child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
		child.on("error", () => {
			problem ??= "Upload process could not run";
		});
		child.on("close", (code, exitSignal) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (exitSignal) problem ??= `Upload process ended by ${exitSignal}`;
			resolve({ code, stdout, stderr, problem });
		});
	});
}

type Dependencies = {
	readReceipt: typeof receipt;
	run: (args: string[], signal: AbortSignal) => Promise<CommandResult>;
	wait: (ms: number, signal: AbortSignal) => Promise<void>;
	log: (message: string) => void;
};
const defaults: Dependencies = {
	readReceipt: receipt,
	run: (args, signal) => runCommand("nsc", args, COMMAND_TIMEOUT_MS, signal),
	wait: (ms, signal) => sleep(ms, undefined, { signal }),
	log: (message) => console.error(message),
};

export async function uploadHandoff(
	file: string,
	destination: string,
	signal: AbortSignal,
	deps: Dependencies = defaults,
): Promise<void> {
	signal.throwIfAborted();
	const expected = await deps.readReceipt(file);
	deps.log(`handoff receipt: ${expected.sha256} (${expected.bytes} bytes)`);
	const assertUnchanged = async () => {
		signal.throwIfAborted();
		const actual = await deps.readReceipt(file);
		if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
			throw new Error("Handoff input changed; refusing upload/retry");
		signal.throwIfAborted();
	};
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		await assertUnchanged();
		deps.log(`Handoff upload attempt ${attempt}/${ATTEMPTS}`);
		const result = await deps.run(
			["artifact", "upload", file, destination, "--expires_in=24h"],
			signal,
		);
		// Keep the original CLI failure visible. Its text is data, never evaluated.
		if (result.stdout) deps.log(result.stdout);
		if (result.stderr) deps.log(result.stderr);
		await assertUnchanged();
		if (result.code === 0 && !result.problem) return;
		if (attempt === ATTEMPTS || !retryableFinalizeFailure(result))
			throw new Error(
				result.problem ?? `Handoff upload failed (exit ${result.code})`,
			);
		deps.log(
			"Retrying identical handoff bytes after finalize DeadlineExceeded",
		);
		await deps.wait(attempt * 5_000, signal);
	}
}

if (import.meta.main) {
	const [file, destination] = process.argv.slice(2);
	if (!file || !destination)
		throw new Error("Expected file and attempt-scoped destination");
	const controller = new AbortController();
	const abort = () => controller.abort();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	try {
		await uploadHandoff(file, destination, controller.signal);
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "Handoff upload failed",
		);
		process.exitCode = 1;
	} finally {
		process.removeListener("SIGINT", abort);
		process.removeListener("SIGTERM", abort);
	}
}
