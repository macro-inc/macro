import { expect, test } from "bun:test";
import { base32, totp } from "../totp.ts";

test("totp: RFC 6238 SHA1 vectors", async () => {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
	const at = (seconds: number) =>
		Temporal.Instant.fromEpochMilliseconds(seconds * 1000);
	expect(new TextDecoder().decode(base32(secret))).toBe("12345678901234567890");
	expect(await totp(secret, at(59), 8)).toBe("94287082");
	expect(await totp(secret, at(1_111_111_109), 8)).toBe("07081804");
	expect(await totp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", at(59))).toBe(
		"287082",
	);
	expect(() => base32("not base32!")).toThrow("base32");
});
