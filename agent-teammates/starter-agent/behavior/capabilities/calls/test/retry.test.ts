import { afterEach, expect, jest, test } from "bun:test";
import type { Clock } from "@muppet/lib/utilities/time";
import {
	type Attempt,
	rejoinDelay,
	retry,
	roomConnect,
	tokenRetry,
} from "../retry.ts";

/** A clock the test moves: sleeping passes the time at once, and says how long it was asked to wait. */
const fakeClock = (): Clock & { readonly slept: readonly number[] } => {
	let now = Temporal.Instant.fromEpochMilliseconds(0);
	const slept: number[] = [];
	return {
		now: () => now,
		sleep: async (milliseconds) => {
			slept.push(milliseconds);
			now = now.add({ milliseconds });
		},
		slept,
	};
};

afterEach(() => {
	jest.useRealTimers();
});

test("a hung token request times out per attempt and the retry gets the token", async () => {
	// The deadline is a timer, so the test owns the timers: nothing here really waits.
	jest.useFakeTimers();
	const clock = fakeClock();
	const attempts: Attempt[] = [];
	const aborted: boolean[] = [];
	let calls = 0;
	const result = retry(
		async (signal) => {
			calls += 1;
			if (calls > 1) return "token";
			signal.addEventListener("abort", () => aborted.push(true));
			// Hangs forever, like the 46 s connect.
			return new Promise<string>(() => {});
		},
		{ ...tokenRetry, clock, onAttempt: (attempt) => attempts.push(attempt) },
	);
	jest.advanceTimersByTime(tokenRetry.timeoutMs);
	expect(await result).toBe("token");
	expect(attempts.map(({ error }) => error !== undefined)).toEqual([
		true,
		false,
	]);
	expect(attempts[0]?.error).toContain("timed out");
	// The hung request is called off, not left running beside the retry.
	expect(aborted).toEqual([true]);
	expect(clock.slept).toEqual([250]);
});

test("ConnectionRefused is retried with backoff, then the last error is thrown", async () => {
	const clock = fakeClock();
	const attempts: Attempt[] = [];
	const error: unknown = await retry(
		async () => {
			throw new Error('join channel: undefined {"code":"ConnectionRefused"}');
		},
		{ ...tokenRetry, clock, onAttempt: (attempt) => attempts.push(attempt) },
	).catch((thrown: unknown) => thrown);
	expect(String(error)).toContain("ConnectionRefused");
	expect(attempts).toHaveLength(4);
	expect(clock.slept).toEqual([250, 750, 1500]);
});

test("the token retry budget fails within about 10 s in the worst case", () => {
	const worst =
		tokenRetry.attempts * tokenRetry.timeoutMs +
		tokenRetry.backoffMs.reduce((sum, ms) => sum + ms, 0);
	expect(worst).toBeLessThanOrEqual(11_000);
});

test("the watcher retries a failed join quickly, backing off to 8 s", () => {
	expect([1, 2, 3, 4, 5, 9].map(rejoinDelay)).toEqual([
		1000, 2000, 4000, 8000, 8000, 8000,
	]);
});

// What the join does with `retry`.

test("the token request gives up with the last error after its attempts, so the join fails fast", async () => {
	const clock = fakeClock();
	let calls = 0;
	const error: unknown = await retry(
		async () => {
			calls += 1;
			throw new Error("ConnectionRefused");
		},
		{ attempts: 3, timeoutMs: 50, backoffMs: [1, 1], clock },
	).catch((thrown: unknown) => thrown);
	expect(String(error)).toContain("ConnectionRefused");
	expect(calls).toBe(3);
	expect(clock.slept).toEqual([1, 1]);
});

test("an error another try can't fix is thrown at once, and still logged as an attempt", async () => {
	const clock = fakeClock();
	const refused = Object.assign(new Error("other call"), {
		name: "InOtherCallError",
		status: 409,
	});
	const attempts: Attempt[] = [];
	let calls = 0;
	const error: unknown = await retry(
		async () => {
			calls += 1;
			throw refused;
		},
		{
			...tokenRetry,
			clock,
			shouldRetry: () => false,
			onAttempt: (attempt) => attempts.push(attempt),
		},
	).catch((thrown: unknown) => thrown);
	expect(error).toBe(refused);
	expect(calls).toBe(1);
	expect(attempts).toMatchObject([{ attempt: 1, error: "other call" }]);
	expect(clock.slept).toEqual([]);
});

test("each attempt reports how long it took, by the clock", async () => {
	const clock = fakeClock();
	const attempts: Attempt[] = [];
	await retry(
		async () => {
			await clock.sleep(120);
			return "token";
		},
		{ ...tokenRetry, clock, onAttempt: (attempt) => attempts.push(attempt) },
	);
	expect(attempts).toEqual([{ attempt: 1, ms: 120 }]);
});

test("the room connect is one attempt with a 10 s deadline: a Room can't be reconnected mid-connect", async () => {
	expect(roomConnect).toEqual({
		attempts: 1,
		timeoutMs: 10_000,
		backoffMs: [],
	});
	const clock = fakeClock();
	let calls = 0;
	const error: unknown = await retry(
		async () => {
			calls += 1;
			throw new Error("room");
		},
		{ ...roomConnect, clock },
	).catch((thrown: unknown) => thrown);
	expect(String(error)).toContain("room");
	expect(calls).toBe(1);
	expect(clock.slept).toEqual([]);
});
