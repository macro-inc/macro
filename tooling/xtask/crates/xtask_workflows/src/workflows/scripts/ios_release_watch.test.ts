import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./ios_release_watch.sh", import.meta.url),
);
type Run = { databaseId: number; status: string; url: string };

const modern = {
	databaseId: 101,
	status: "completed",
	url: "https://github.com/example/repo/actions/runs/101",
};
const legacy = {
	databaseId: 202,
	status: "completed",
	url: "https://github.com/example/repo/actions/runs/202",
};

function watch({
	current = modern,
	previous = legacy,
	modernConclusion = "success",
	legacyConclusion = "failure",
	approved = true,
	comments = [],
}: {
	current?: Run | null;
	previous?: Run | null;
	modernConclusion?: string;
	legacyConclusion?: string;
	approved?: boolean;
	comments?: { body: string }[];
} = {}) {
	const directory = mkdtempSync(join(tmpdir(), "ios-release-watch-"));
	mkdirSync(join(directory, "apps/web"), { recursive: true });
	const reruns = join(directory, "reruns");
	const env = {
		...process.env,
		BASH_ENV: "",
		WATCH_SCRIPT: script,
		GH_REPO: "example/repo",
		RUNNER_TEMP: directory,
		PRS: JSON.stringify([{ number: 1, sha: "head", merge: "merge" }]),
		MODERN_RUN: current ? JSON.stringify(current) : "",
		LEGACY_RUN: previous ? JSON.stringify(previous) : "",
		RUN_JOBS: JSON.stringify({
			101: {
				jobs: [
					{
						name: "Web App / iOS Native Check",
						databaseId: 11,
						conclusion: modernConclusion,
					},
				],
			},
			202: {
				jobs: [
					{
						name: "iOS Native Check",
						databaseId: 22,
						conclusion: legacyConclusion,
					},
				],
			},
		}),
		COMMENTS: JSON.stringify({ comments }),
		APPROVAL_EXIT: approved ? "0" : "1",
		RERUNS: reruns,
	};

	try {
		execFileSync(
			"bash",
			[
				"-c",
				`
      set -euo pipefail
      native_tree_fetch() { :; }
      native_tree_hash() { echo native-tree; }
      pr_ci_run() { printf '%s\\n' "$MODERN_RUN"; }
      bun() {
        if [[ "$2" == withdraw ]]; then return 0; fi
        return "$APPROVAL_EXIT"
      }
      gh() {
        local query
        for query in "$@"; do :; done
        case "$1 $2" in
          'api '*)
            printf '%s' '{"version":"1.0.0","bundle":{"iOS":{"bundleVersion":"1"}}}' | base64
            ;;
          'run list')
            [[ "$*" == *'--commit head'* && "$*" == *'--event pull_request'* ]]
            printf '%s\\n' "$LEGACY_RUN"
            ;;
          'run view')
            jq -c --arg run "$3" '.[$run]' <<<"$RUN_JOBS" | jq -c "$query"
            ;;
          'pr view') jq "$query" <<<"$COMMENTS" ;;
          'run rerun') echo "$3" >> "$RERUNS" ;;
          'pr comment') : ;;
          *) echo "Unexpected gh call: $*" >&2; return 1 ;;
        esac
      }
      source "$WATCH_SCRIPT"
    `,
			],
			{ cwd: directory, env, encoding: "utf8", stdio: "pipe" },
		);

		return existsSync(reruns)
			? readFileSync(reruns, "utf8").trim().split("\n")
			: [];
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("approval clears a legacy failure even when the new CI run passed", () => {
	assert.deepEqual(watch(), ["202"]);
});

test("approval finds a failure from before PR CI existed", () => {
	assert.deepEqual(watch({ current: null }), ["202"]);
});

test("approval rechecks failures in both workflow generations", () => {
	assert.deepEqual(watch({ modernConclusion: "failure" }), ["101", "202"]);
});

test("a PR with only the current workflow still gets rechecked", () => {
	assert.deepEqual(watch({ previous: null, modernConclusion: "failure" }), [
		"101",
	]);
});

test("unapproved releases and successful gates never get rechecked", () => {
	assert.deepEqual(watch({ approved: false }), []);
	assert.deepEqual(watch({ legacyConclusion: "success" }), []);
});

test("the retry limit applies separately to each run", () => {
	const comments = [
		{
			body: `iOS 1.0.0 (build 1). Re-ran the **iOS Native Check** ([run](${modern.url}))`,
		},
		{
			body: `iOS 1.0.0 (build 1). Re-ran the **iOS Native Check** ([run](${modern.url}))`,
		},
	];
	assert.deepEqual(watch({ modernConclusion: "failure", comments }), ["202"]);
});
