import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./release_wait_for_checks.sh", import.meta.url),
);

type Check = { name: string; bucket: string; description?: string };

// `gh pr checks` lists two entries named "CI gate": the PR CI job, which has
// no description, and the commit status, which says what CI did.
const gateJob = { name: "CI gate", bucket: "fail", description: "" };
const gateFailedOnNativeChecks = {
	name: "CI gate",
	bucket: "fail",
	description: "Failed: web-app",
};
const nativeChecks: Check[] = [
	{ name: "Web App / iOS Native Check", bucket: "fail" },
	{ name: "Web App / Android Native Check", bucket: "fail" },
	{ name: "Web App / Web App Status Check", bucket: "fail" },
	{ name: "Re-run the native check", bucket: "skipping" },
];
const typecheck = { name: "Web App / Typecheck", bucket: "pass" };

/** Runs the step as a release workflow does, against a listing of checks. */
function release(label: "android-update" | "ios-update", checks: Check[]) {
	const directory = mkdtempSync(join(tmpdir(), "release-wait-"));
	try {
		const listing = join(directory, "checks.json");
		writeFileSync(
			listing,
			JSON.stringify(checks.map((check) => ({ description: "", ...check }))),
		);
		for (const [tool, body] of [
			["gh", `cat "${listing}"`],
			// A pending check is polled each minute; the scenarios do not wait.
			["sleep", "exit 0"],
		]) {
			writeFileSync(join(directory, tool), `#!/usr/bin/env bash\n${body}\n`);
			chmodSync(join(directory, tool), 0o755);
		}
		const run = spawnSync(
			"bash",
			[
				"-c",
				'set -euo pipefail; head_sha=0123456789abcdef; source "$1"',
				"bash",
				script,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					BASH_ENV: "",
					PATH: `${directory}:${process.env.PATH}`,
					PR_NUMBER: "1",
					GH_REPO: "example/repo",
					WAIT_MINUTES: "0",
					RELEASE_LABEL: label,
				},
			},
		);
		return { status: run.status, output: `${run.stdout}${run.stderr}` };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("an Android release starts although the iOS release failed", () => {
	const run = release("android-update", [
		gateJob,
		...nativeChecks,
		typecheck,
		{ name: "iOS App Store Release", bucket: "fail" },
		{ name: "iOS Release Drift", bucket: "fail" },
		gateFailedOnNativeChecks,
	]);

	assert.equal(run.status, 0, run.output);
	assert.match(run.output, /All other checks on 0123456789 pass \(1 checks\)/);
});

test("an iOS release starts although the Android release failed", () => {
	const run = release("ios-update", [
		gateJob,
		...nativeChecks,
		typecheck,
		{ name: "Android Play Release", bucket: "fail" },
		{ name: "Android Release Drift", bucket: "fail" },
		{ name: "android-play/release", bucket: "fail" },
		gateFailedOnNativeChecks,
	]);

	assert.equal(run.status, 0, run.output);
});

test("a release starts while the other store's release is in flight", () => {
	for (const [label, other] of [
		["android-update", "iOS App Store Release"],
		["ios-update", "Android Play Release"],
		["ios-update", "android-play/release"],
	] as const) {
		const run = release(label, [
			gateJob,
			...nativeChecks,
			typecheck,
			{ name: other, bucket: "pending" },
			gateFailedOnNativeChecks,
		]);

		assert.equal(run.status, 0, `${label} with ${other} pending: ${run.output}`);
	}
});

test("a release is refused while any other check fails", () => {
	for (const failing of [
		"Web App / Typecheck",
		// Names that only contain or begin like an ignored one still count.
		"Re-run the iOS Native Check once Apple approves the App Store release",
		"Re-run the Android Native Check once the Play release is live",
		"CI gate for forks",
	]) {
		const run = release("android-update", [
			gateJob,
			...nativeChecks,
			{ name: failing, bucket: "fail" },
			gateFailedOnNativeChecks,
		]);

		assert.equal(run.status, 1, `${failing}: ${run.output}`);
		assert.ok(
			run.output.includes(
				`has failing checks: ${failing}. Get the PR green, then re-add android-update.`,
			),
			run.output,
		);
	}
});

test("a release is refused once another check stays pending past the wait", () => {
	const run = release("ios-update", [
		gateJob,
		...nativeChecks,
		{ name: "Web App / Build", bucket: "pending" },
		gateFailedOnNativeChecks,
	]);

	assert.equal(run.status, 1, run.output);
	assert.match(
		run.output,
		/Checks still pending after 0 minutes: Web App \/ Build\. Re-add ios-update once they pass\./,
	);
});

test("a release is refused when CI has not run on the head", () => {
	const run = release("android-update", [
		typecheck,
		{
			name: "CI gate",
			bucket: "pending",
			description: "Not run on this commit. Run: gh api …",
		},
	]);

	assert.equal(run.status, 1, run.output);
	assert.match(run.output, /CI has not run on 0123456789\..*re-add android-update/);
});

test("a release waits on CI that is still running", () => {
	const run = release("android-update", [
		{ name: "CI gate", bucket: "pending", description: "" },
		typecheck,
		{ name: "CI gate", bucket: "pending", description: "Running on 0123456" },
	]);

	assert.equal(run.status, 1, run.output);
	assert.match(run.output, /Checks still pending after 0 minutes: CI gate\./);
});
