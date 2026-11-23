import { describe, expect, test } from "bun:test";
import { due, type Entry, nextFire, type Run } from "../due.ts";
import type { Schedule } from "../schedule.ts";

const at = (text: string) => Temporal.Instant.from(text);
const entry = (schedule: Schedule, run: Run = {}): Entry => ({ schedule, run });
const when = (e: Entry, now: string) => {
	const next = nextFire(e, at(now), "UTC");
	return next.when === null ? next.why : next.when.toString();
};

describe("nextFire", () => {
	test("an every fires at once, then its length after the last run ended", () => {
		expect(when(entry({ every: "10m" }), "2026-11-09T09:00:00Z")).toBe(
			"2026-11-09T09:00:00Z",
		);
		expect(
			when(
				entry({ every: "10m" }, { ended: "2026-11-09T09:07:00Z" }),
				"2026-11-09T09:08:00Z",
			),
		).toBe("2026-11-09T09:17:00Z");
	});

	test("a new rule fires the occurrence it is standing on, within grace", () => {
		expect(
			when(entry({ rule: "FREQ=HOURLY;BYMINUTE=0" }), "2026-11-09T09:03:00Z"),
		).toBe("2026-11-09T09:00:00Z");
		expect(
			when(entry({ rule: "FREQ=HOURLY;BYMINUTE=0" }), "2026-11-09T09:30:00Z"),
		).toBe("2026-11-09T10:00:00Z");
	});

	test("a rule chains from the occurrence that last fired, not from when it ran", () => {
		expect(
			when(
				entry(
					{ rule: "FREQ=HOURLY;BYMINUTE=0" },
					{ due: "2026-11-09T09:00:00Z", ended: "2026-11-09T09:40:00Z" },
				),
				"2026-11-09T09:41:00Z",
			),
		).toBe("2026-11-09T10:00:00Z");
	});

	test("an at fires once, and paused fires never", () => {
		const once = entry({ at: "2026-11-09T15:00:00Z" });
		expect(when(once, "2026-11-09T09:00:00Z")).toBe("2026-11-09T15:00:00Z");
		expect(
			when(
				{ ...once, run: { started: "2026-11-09T15:00:00Z" } },
				"2026-11-09T16:00:00Z",
			),
		).toBe("done");
		expect(
			when(entry({ every: "1m" }, { paused: true }), "2026-11-09T09:00:00Z"),
		).toBe("paused");
	});
});

describe("due", () => {
	const table = {
		poll: entry({ every: "1m" }),
		hourly: entry(
			{ rule: "FREQ=HOURLY;BYMINUTE=0" },
			{ due: "2026-11-09T07:00:00Z" },
		),
		caught: entry(
			{ rule: "FREQ=HOURLY;BYMINUTE=0", catchUp: true },
			{ due: "2026-11-09T07:00:00Z" },
		),
		reminder: entry({ at: "2026-11-09T06:00:00Z" }),
		busy: entry({ every: "1m" }, { running: true }),
		broken: entry({ every: "soon" }),
	};

	test("fires what is due, misses what is too late, and reports what is broken", () => {
		const verdict = due(table, at("2026-11-09T09:30:00Z"), "UTC");
		expect(verdict.fire.map(({ name, due }) => `${name} ${due}`)).toEqual([
			"poll 2026-11-09T09:30:00Z",
			"caught 2026-11-09T08:00:00Z",
		]);
		expect(verdict.miss.map(({ name, due }) => `${name} ${due}`)).toEqual([
			"hourly 2026-11-09T08:00:00Z",
			"reminder 2026-11-09T06:00:00Z",
		]);
		expect(verdict.errors.map(({ name }) => name)).toEqual(["broken"]);
	});
});
