/**
 * Retries with a deadline per attempt. Bun's fetch has no connect timeout: a
 * connection that hangs waits indefinitely, and the caller hears nothing
 * meanwhile. Each attempt gets a deadline and a fresh request; the whole
 * thing stays within about 10 s.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import { elapsed } from "./config.ts";

export type Attempt = {
	readonly attempt: number;
	readonly ms: number;
	readonly error?: string;
};

export type RetryOptions = {
	readonly attempts: number;
	readonly timeoutMs: number;
	/** The wait after each failed attempt; the last one repeats. */
	readonly backoffMs: readonly number[];
};

/** The token request: worst case about 10.5 s. */
export const tokenRetry: RetryOptions = {
	attempts: 4,
	timeoutMs: 2000,
	backoffMs: [250, 750, 1500],
};

/** One attempt, no waiting between: a Room isn't reconnectable mid-connect, so the watcher rejoins fresh. */
export const roomConnect: RetryOptions = {
	attempts: 1,
	timeoutMs: 10_000,
	backoffMs: [],
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Rejects after `ms`, aborting `abort`. Returns the promise and the means to call it off. */
const deadline = (
	ms: number,
	abort: AbortController,
): { readonly passed: Promise<never>; readonly clear: () => void } => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const passed = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			abort.abort();
			reject(new Error(`timed out after ${ms} ms`));
		}, ms);
	});
	return { passed, clear: () => clearTimeout(timer) };
};

export const retry = async <Value>(
	attempt: (signal: AbortSignal) => Promise<Value>,
	{
		attempts,
		timeoutMs,
		backoffMs,
		clock,
		onAttempt,
		shouldRetry,
	}: RetryOptions & {
		readonly clock: Clock;
		/** Told about every attempt, for the call's event log. */
		readonly onAttempt?: (attempt: Attempt) => void;
		/** False for an error that another try can't fix, e.g. Macro refusing to seat the agent. */
		readonly shouldRetry?: (error: unknown) => boolean;
	},
): Promise<Value> => {
	let last: unknown;
	for (let number = 1; number <= attempts; number++) {
		const abort = new AbortController();
		const started = clock.now();
		const ms = () => Math.round(elapsed(clock.now(), started));
		const { passed, clear } = deadline(timeoutMs, abort);
		try {
			const value = await Promise.race([attempt(abort.signal), passed]);
			onAttempt?.({ attempt: number, ms: ms() });
			return value;
		} catch (error) {
			last = error;
			onAttempt?.({ attempt: number, ms: ms(), error: message(error) });
			if (shouldRetry !== undefined && !shouldRetry(error)) throw error;
			if (number < attempts)
				await clock.sleep(backoffMs[number - 1] ?? backoffMs.at(-1) ?? 0);
		} finally {
			clear();
		}
	}
	throw last;
};

/** After a failed join, how soon the watcher tries the same live call again: 1, 2, 4, then 8 s. */
export const rejoinDelay = (failures: number): number =>
	Math.min(1000 * 2 ** Math.max(0, failures - 1), 8000);
