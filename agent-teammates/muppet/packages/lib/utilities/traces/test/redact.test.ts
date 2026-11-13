import { expect, test } from "bun:test";
import { credentialValues, redactor } from "../redact.ts";

test("replaces exact values longest first and ignores short values", () => {
	const redact = redactor(["fake-secret-long", "fake-secret", "short"]);
	expect(
		redact.text("fake-secret-long fake-secret short fake-secret-long"),
	).toBe("[secret] [secret] short [secret]");
});

// Built from parts, so no whole token-shaped string sits in the source for secret scanners to flag.
const fill = (count: number): string => "A".repeat(count);
test.each([
	...["p", "o", "u", "s", "r"].map((kind) => `gh${kind}_${fill(20)}`),
	`github${"_"}pat_${fill(20)}`,
	`sk-${fill(16)}`,
	`sk-${"ant"}-${fill(16)}`,
	`GOCSPX-${fill(16)}`,
	...["b", "a", "p", "r"].map((kind) => `xox${kind}-${fill(16)}`),
	`AKIA${fill(16)}`,
	["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0In0", "AAAAAA"].join("."),
])("redacts a token pattern", (token) => {
	expect(redactor([]).text(`before ${token} after`)).toBe(
		"before [secret] after",
	);
});

test("redacts authorization, passwords, and private keys", () => {
	const redact = redactor([]);
	expect(
		redact.text(
			"Bearer abc123 Basic ZmFrZQ== password=letmein password: hello",
		),
	).toBe("Bearer [secret] Basic [secret] password=[secret] password: [secret]");
	expect(
		redact.text(
			`start -----BEGIN TEST ${"PRIVATE"} KEY-----\nfake\n-----END TEST ${"PRIVATE"} KEY----- end`,
		),
	).toBe("start [secret] end");
});

test("redacts sensitive URL fields and keeps other URL parts readable", () => {
	const redact = redactor([]);
	expect(
		redact.text(
			"https://example.test/path?view=all&token=fake123#session=abc789",
		),
	).toBe("https://example.test/path?view=all&token=[secret]#session=[secret]");
	expect(
		redact.text("https://example.test/?X-Amz-Signature=abc&code=xyz&other=ok"),
	).toBe(
		"https://example.test/?X-Amz-Signature=[secret]&code=[secret]&other=ok",
	);
});

test("replaces verification codes in prose but keeps ordinary identifiers", () => {
	const redact = redactor([]);
	expect(
		redact.text(
			"code is 482913; verification code: ABC123; OTP 4411; PIN 1234",
		),
	).toBe("code is [code]; verification code: [code]; OTP [code]; PIN [code]");
	expect(
		redact.text(
			"2026-11-10T22:01:24Z 01a1c76a-aaaa-4bbb-8ccc-123456789abc 20261110T220124Z 95020a8d3a3c $0.25 4411",
		),
	).toBe(
		"2026-11-10T22:01:24Z 01a1c76a-aaaa-4bbb-8ccc-123456789abc 20261110T220124Z 95020a8d3a3c $0.25 4411",
	);
});

test("deep maps strings and secret keys, leaving non-JSON values alone", () => {
	const redact = redactor(["fake-secret-long"]);
	const other = new Map([["password", "fake-secret-long"]]);
	expect(
		redact.value({
			nested: [{ note: "fake-secret-long", api_key: 1234, code: "1234" }],
			credentials: { authorization: "anything", count: 2 },
			other,
			exit: { code: 0 },
			script: { code: "export async function main() {}" },
		}),
	).toEqual({
		nested: [{ note: "[secret]", api_key: "[secret]", code: "[secret]" }],
		credentials: { authorization: "[secret]", count: 2 },
		other,
		exit: { code: 0 },
		script: { code: "export async function main() {}" },
	});
});

test("exact values are replaced before a pattern can match part of one", () => {
	const value = "sk-ant-fakefakefakefake-and-more";
	expect(redactor([value]).text(`key ${value}!`)).toBe("key [secret]!");
	expect(redactor([]).text(`key ${value}!`)).not.toContain("fake");
});

test("redacts strings nested in JSON, and JSON inside a string", () => {
	const redact = redactor(["fake-secret-long"]);
	expect(redact.value({ a: { b: [{ c: ["x fake-secret-long y"] }] } })).toEqual(
		{ a: { b: [{ c: ["x [secret] y"] }] } },
	);
	expect(
		redact.text(
			'{"password":"hunter22","api_key": "k\\"1","code":"x","url":"https://x.test/?token=t1"}',
		),
	).toBe(
		'{"password":"[secret]","api_key": "[secret]","code":"x","url":"https://x.test/?token=[secret]"}',
	);
});

test("credentialValues reads every credential, leaving out ones it can't", async () => {
	const values = credentialValues({
		names: async () => ["a", "b", "c"],
		get: async (name) => {
			if (name === "b") throw new Error("gone");
			return `value-of-${name}`;
		},
	});
	expect(await values()).toEqual(["value-of-a", "value-of-c"]);
});
