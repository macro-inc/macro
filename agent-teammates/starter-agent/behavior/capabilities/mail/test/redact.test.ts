import { describe, expect, test } from "bun:test";
import { linkKeys } from "../message.ts";
import { oneLine, redact } from "../redact.ts";
import { redacted } from "../store.ts";
import { directories, join, mail, memoryDisk, testStore } from "./helpers.ts";

describe("redaction", () => {
	test("codes and reset links never survive", () => {
		const cases: readonly (readonly [string, string])[] = [
			["Your verification code is 482913", "482913"],
			["Log into Service - 153060", "153060"],
			["code: 8K2M-Q9", "8K2M-Q9"],
			["Your OTP 4411 expires", "4411"],
			["G-482913 is your Google verification code", "482913"],
			["your password: hunter2!", "hunter2!"],
			["Reset: https://v.example/reset?token=abc123", "token=abc123"],
			["https://v.example/a/verify/xyz", "/verify/xyz"],
			[
				"https://v.example/x/AbCdEfGhIjKlMnOpQrStUvWx",
				"AbCdEfGhIjKlMnOpQrStUvWx",
			],
			[
				"key ghp_abcdefghijklmnopqrstuvwx1234",
				"ghp_abcdefghijklmnopqrstuvwx1234",
			],
		];
		for (const [input, gone] of cases)
			expect(redact(input)).not.toContain(gone);
	});
	test("ordinary words and amounts survive", () => {
		expect(
			redact("Your invoice for $42.10 is ready at https://v.example/billing"),
		).toBe("Your invoice for $42.10 is ready at https://v.example/billing");
		expect(redact("The code review looks fine")).toBe(
			"The code review looks fine",
		);
	});
	test("a one-liner has no control characters to spoof a log with", () => {
		expect(oneLine("a\r\nb‮c", 80)).toBe("a b c");
	});
	test("the local copy holds no code, and a link only as a hash", async () => {
		const message = mail({
			id: "code1",
			from: "auth@service.example",
			subject: "Log into Service - 153060",
			text: "Your code is 153060 https://v.example/reset/abc?token=zzz",
		});
		expect(JSON.stringify(redacted(message))).not.toContain("153060");
		const disk = memoryDisk();
		const store = testStore(disk);
		const kept = await store.save(message);
		expect(await store.stored("code1")).toEqual(kept);
		expect(kept.links).toEqual([...linkKeys("https://v.example/reset/abc")]);
		const everything = [...disk.files.values()].join("\n");
		expect(everything).not.toContain("153060");
		expect(everything).not.toContain("token=zzz");
		expect(everything).not.toContain("reset/abc");
		expect([...disk.files.keys()]).toEqual([
			join(directories.private, "messages", "code1.json"),
		]);
	});
	test("a mail id is never a path", async () => {
		const store = testStore();
		await expect(async () => store.stored("../../etc/passwd")).toThrow();
	});
});
