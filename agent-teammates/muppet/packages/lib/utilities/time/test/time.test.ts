import { describe, expect, test } from "bun:test";
import { instant, lengthText, milliseconds, timeZone } from "../index.ts";

describe("milliseconds", () => {
	test("reads shorthand and ISO 8601, counting a day as 24 hours", () => {
		expect(milliseconds("90s")).toBe(90_000);
		expect(milliseconds("1h30m")).toBe(5_400_000);
		expect(milliseconds("2d")).toBe(172_800_000);
		expect(milliseconds("PT1H30M")).toBe(5_400_000);
		expect(milliseconds("P1D")).toBe(86_400_000);
	});

	test("refuses nonsense and nothing", () => {
		expect(() => milliseconds("soon")).toThrow("not a length of time");
		expect(() => milliseconds("")).toThrow("not a length of time");
		expect(() => milliseconds("0m")).toThrow("more than zero");
	});
});

test("lengthText writes shorthand", () => {
	expect(lengthText(5_400_000)).toBe("1h30m");
	expect(lengthText(172_800_000)).toBe("2d");
	expect(lengthText(500)).toBe("500ms");
});

test("timeZone canonicalizes a zone and refuses a made-up one", () => {
	expect(timeZone("america/new_york")).toBe("America/New_York");
	expect(() => timeZone("Mars/Olympus")).toThrow("not a time zone");
});

test("instant needs an offset", () => {
	expect(instant("2026-11-09T10:00:00-05:00").toString()).toBe(
		"2026-11-09T15:00:00Z",
	);
	expect(() => instant("2026-11-09T10:00:00")).toThrow("give it a Z");
});
