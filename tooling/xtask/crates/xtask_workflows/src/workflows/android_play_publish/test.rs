use super::*;
use crate::workflows::{android_play_release, android_release_drift, web_app_check_main};

/// Run `script` under bash after `fakes`, with `env`, returning the exit
/// status, stdout + stderr, and what the script wrote to `$GITHUB_OUTPUT`.
fn run(fakes: &str, script: &str, env: &[(&str, &str)]) -> (bool, String, String) {
    let outputs = tempfile::NamedTempFile::new().expect("step outputs");
    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(format!("{fakes}\n{script}"))
        .env_remove("BASH_ENV")
        .env("GITHUB_OUTPUT", outputs.path())
        .env("GH_REPO", "example/repo")
        .envs(env.iter().copied())
        .output()
        .expect("run script");
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let outputs = std::fs::read_to_string(outputs.path()).expect("read step outputs");
    (output.status.success(), log, outputs)
}

fn output<'a>(outputs: &'a str, key: &str) -> Option<&'a str> {
    outputs
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")))
}

const VERIFY_FAKES: &str = r#"
gh() {
  case "$*" in
    "api repos/example/repo/actions/runs/7/attempts/1/jobs "*) echo "$FAKE_BUILD" ;;
    "pr list --repo example/repo --head feature --base main --state open "*) echo "$FAKE_PR" ;;
    "pr view 5 --repo example/repo --json labels "*) echo "$FAKE_LABELED" ;;
    "api --paginate repos/example/repo/issues/5/events "*) [[ -z "$FAKE_EVENTS" ]] || printf '%s\n' "$FAKE_EVENTS" ;;
    "api repos/example/repo/collaborators/alice/permission "*) echo "$FAKE_PERMISSION" ;;
    *) echo "unexpected: gh $*" >&2; return 1 ;;
  esac
}
gh_fetch() { [[ "$1" == "$HEAD_SHA" ]]; }
bun() { [[ "$*" == "scripts/android-native.mjs version-code $HEAD_SHA" ]] && echo 22; }
git() { [[ "$1 $2" == "show ${HEAD_SHA}:apps/web/tauri/src-tauri/tauri.android.conf.json" ]] && echo '{"version":"2.0.1"}'; }
"#;

/// What the publisher's check should make of a build run.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Expect {
    Publish,
    /// Nothing to publish: end quietly.
    Skip,
    /// Fail, saying why.
    Refuse,
}

/// A scenario: its name, the environment it overrides, the expected outcome.
type Case<'a> = (&'a str, &'a [(&'a str, &'a str)], Expect);

const LABELED_BY_ALICE: &str =
    r#"{"event":"labeled","login":"alice","type":"User","at":"2026-11-03T10:00:00Z"}"#;

/// The publisher's `check` job: only a successful build that a person with
/// write access started by adding `android-update` is published.
#[test]
fn publishes_only_a_build_the_label_started() {
    let script = include_str!("../scripts/android_play_publish_verify.sh");
    let unlabeled = format!(
        "{LABELED_BY_ALICE}\n{}",
        r#"{"event":"unlabeled","login":"alice","type":"User","at":"2026-11-03T10:01:00Z"}"#
    );
    let bob_later = format!(
        "{LABELED_BY_ALICE}\n{}",
        r#"{"event":"labeled","login":"bob","type":"User","at":"2026-11-03T10:02:00Z"}"#
    );
    let bot = r#"{"event":"labeled","login":"alice","type":"Bot","at":"2026-11-03T10:00:00Z"}"#;
    let cases: &[Case] = &[
        ("labeled by a writer", &[], Expect::Publish),
        (
            "another workflow file",
            &[("RUN_PATH", ".github/workflows/other.yml")],
            Expect::Skip,
        ),
        (
            "release job skipped",
            &[("FAKE_BUILD", "skipped")],
            Expect::Skip,
        ),
        ("no open PR", &[("FAKE_PR", "")], Expect::Refuse),
        ("label gone", &[("FAKE_LABELED", "false")], Expect::Refuse),
        (
            "label last removed",
            &[("FAKE_EVENTS", &unlabeled)],
            Expect::Refuse,
        ),
        ("no label events", &[("FAKE_EVENTS", "")], Expect::Refuse),
        ("added by a bot", &[("FAKE_EVENTS", bot)], Expect::Refuse),
        (
            "someone else added it since",
            &[("FAKE_EVENTS", &bob_later)],
            Expect::Refuse,
        ),
        (
            "started by someone else",
            &[("RUN_ACTOR", "mallory")],
            Expect::Refuse,
        ),
        (
            "read access only",
            &[("FAKE_PERMISSION", "read")],
            Expect::Refuse,
        ),
        (
            "run created by a later push",
            &[("RUN_CREATED_AT", "2026-11-03T10:20:00Z")],
            Expect::Refuse,
        ),
        (
            "run created before the label",
            &[("RUN_CREATED_AT", "2026-11-03T09:55:00Z")],
            Expect::Refuse,
        ),
    ];
    for (case, overrides, expected) in cases {
        let mut env = vec![
            ("RUN_ID", "7"),
            ("RUN_ATTEMPT", "1"),
            ("RUN_PATH", ".github/workflows/android-play-release.yml"),
            ("RUN_ACTOR", "alice"),
            ("RUN_CREATED_AT", "2026-11-03T10:00:04Z"),
            ("HEAD_SHA", "abc123"),
            ("HEAD_BRANCH", "feature"),
            ("FAKE_BUILD", "success"),
            ("FAKE_PR", "5"),
            ("FAKE_LABELED", "true"),
            ("FAKE_EVENTS", LABELED_BY_ALICE),
            ("FAKE_PERMISSION", "write"),
        ];
        for &(key, value) in overrides.iter() {
            env.retain(|&(k, _)| k != key);
            env.push((key, value));
        }
        let (ok, log, outputs) = run(VERIFY_FAKES, script, &env);
        if *expected == Expect::Refuse {
            assert!(!ok, "{case} must be refused: {log}");
            assert!(log.contains("Not publishing run 7: "), "{case}: {log}");
            assert_eq!(output(&outputs, "publish"), None, "{case}: {outputs}");
            continue;
        }
        assert!(ok, "{case}: {log}");
        let publish = *expected == Expect::Publish;
        assert_eq!(
            output(&outputs, "publish"),
            Some(if publish { "true" } else { "false" }),
            "{case}: {outputs}"
        );
        if publish {
            assert_eq!(output(&outputs, "pr_number"), Some("5"));
            assert_eq!(output(&outputs, "version_code"), Some("22"));
            assert_eq!(output(&outputs, "release_name"), Some("2.0.1 (22)"));
        }
    }
}

const HASH: &str = "1c42afd83e761d9bd933b645bbd239e817b4462e";

/// The merge gate finds the watcher's `android-play/live` status on any of
/// the PR's commits, but only for this version code, merge-result native
/// hash and PR.
#[test]
fn gate_requires_a_matching_live_status() {
    let script = concat!(
        include_str!("../scripts/android_play_statuses.sh"),
        include_str!("../scripts/android_native_check_live.sh")
    );
    let fakes = r#"
pr_merge_commit() { echo merge; }
gh_fetch() { [[ "$1" == merge ]]; }
bun() { [[ "$*" == "scripts/android-native.mjs hash merge" ]] && echo "$FAKE_HASH"; }
gh() {
  [[ "$1 $2" == "api graphql" && "$*" == *"context=android-play/live"* && "$*" == *"pr=5"* ]] || return 1
  [[ -z "$FAKE_STATUSES" ]] || printf '%s\n' "$FAKE_STATUSES"
}
"#;
    let live = |code: &str, hash: &str, pr: &str| {
        format!("Version code {code} is live on Google Play (native tree {hash}, PR #{pr})")
    };
    let other_hash = "0000000000000000000000000000000000000000";
    let cases = [
        (
            "live on an older commit",
            format!("old success {}\nhead pending x", live("22", HASH, "5")),
            true,
        ),
        ("no statuses", String::new(), false),
        (
            "still pending",
            format!("head pending {}", live("22", HASH, "5")),
            false,
        ),
        (
            "other native tree",
            format!("head success {}", live("22", other_hash, "5")),
            false,
        ),
        (
            "other version code",
            format!("head success {}", live("2", HASH, "5")),
            false,
        ),
        (
            "other PR",
            format!("head success {}", live("22", HASH, "6")),
            false,
        ),
    ];
    for (case, statuses, pass) in cases {
        let (ok, log, _) = run(
            fakes,
            script,
            &[
                ("PR_NUMBER", "5"),
                ("VERSION_CODE", "22"),
                ("FAKE_HASH", HASH),
                ("FAKE_STATUSES", &statuses),
            ],
        );
        assert_eq!(ok, pass, "{case}: {log}");
    }
}

/// Drift reads whether the publisher submitted the stale version code:
/// success is promoted, pending or failure unknown, nothing not promoted.
#[test]
fn drift_reads_the_promotion_from_the_release_status() {
    let script = concat!(
        include_str!("../scripts/android_play_statuses.sh"),
        include_str!("../scripts/android_release_drift_promoted.sh")
    );
    let fakes = r#"
gh() {
  case "$*" in
    "run list --repo example/repo --workflow android-play-publish.yml "*) [[ "$FAKE_RUNS" != fail ]] && echo "$FAKE_RUNS" ;;
    "api repos/example/repo/commits/before/status "*) [[ -z "$FAKE_BEFORE" ]] || printf '%s\n' "$FAKE_BEFORE" ;;
    "api graphql "*) [[ -z "$FAKE_PR_STATUSES" ]] || printf '%s\n' "$FAKE_PR_STATUSES" ;;
    *) echo "unexpected: gh $*" >&2; return 1 ;;
  esac
}
"#;
    let release = |code: &str| format!("Version code {code} (native tree {HASH})");
    let cases = [
        (
            "submitted from the old head",
            "0",
            format!("success {}", release("20")),
            String::new(),
            Some("true"),
        ),
        (
            "submitted from an earlier commit",
            "0",
            String::new(),
            format!("c1 success {}", release("20")),
            Some("true"),
        ),
        (
            "promotion under way",
            "0",
            format!("pending {}", release("20")),
            String::new(),
            None,
        ),
        (
            "promotion failed midway",
            "0",
            String::new(),
            format!("c1 failure {}", release("20")),
            None,
        ),
        (
            "another version code",
            "0",
            format!("success {}", release("21")),
            String::new(),
            Some("false"),
        ),
        (
            "a code with the same prefix",
            "0",
            format!("success {}", release("200")),
            String::new(),
            Some("false"),
        ),
        (
            "never published",
            "0",
            String::new(),
            String::new(),
            Some("false"),
        ),
        (
            "runs unreadable",
            "fail",
            String::new(),
            String::new(),
            None,
        ),
    ];
    for (case, runs, before, pr_statuses, promoted) in cases {
        let (ok, log, outputs) = run(
            fakes,
            script,
            &[
                ("PR_NUMBER", "5"),
                ("BEFORE_SHA", "before"),
                ("VERSION_CODE", "20"),
                ("FAKE_RUNS", runs),
                ("FAKE_BEFORE", &before),
                ("FAKE_PR_STATUSES", &pr_statuses),
            ],
        );
        assert!(ok, "{case}: the lookup never fails the drift job: {log}");
        assert_eq!(output(&outputs, "promoted"), promoted, "{case}: {log}");
    }
}

/// Google's identity provider admits only main-copy workflows; a PR-side
/// workflow must not even try to sign in to Play.
#[test]
fn only_main_copy_workflows_sign_in_to_play() {
    for (name, yaml) in [
        (
            "android-play-release",
            android_play_release::android_play_release(),
        ),
        (
            "android-release-drift",
            android_release_drift::android_release_drift(),
        ),
        (
            "web-app-check-main",
            web_app_check_main::web_app_check_main(),
        ),
    ] {
        let yaml = yaml.to_string().expect("workflow YAML");
        assert!(
            !yaml.contains("google-github-actions/auth") && !yaml.contains("GOOGLE_PLAY_"),
            "{name} runs PR code and must not sign in to Play"
        );
    }
    let yaml = android_play_publish().to_string().expect("workflow YAML");
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("parsed workflow");
    let on = workflow["on"].as_mapping().expect("triggers");
    assert_eq!(on.len(), 1, "workflow_run only: {yaml}");
    assert!(on.contains_key("workflow_run"));
    assert!(
        workflow["jobs"]["check"]["permissions"]["id-token"].is_null(),
        "the check job needs no Play identity"
    );
    assert_eq!(
        workflow["jobs"]["publish"]["if"].as_str(),
        Some("needs.check.outputs.publish == 'true'")
    );
    let steps: Vec<&str> = workflow["jobs"]["publish"]["steps"]
        .as_sequence()
        .expect("publish steps")
        .iter()
        .filter_map(|step| step["name"].as_str())
        .collect();
    let at = |name: &str| {
        steps
            .iter()
            .position(|step| *step == name)
            .unwrap_or_else(|| panic!("missing step {name}: {steps:?}"))
    };
    assert!(
        at("Require the PR's Android native code to be unchanged since the build")
            < at("Upload to internal testing")
    );
    assert!(at("Write the provenance stamp as release notes") < at("Upload to internal testing"));
    assert!(
        at("Upload to internal testing")
            < at("Require the native code to be unchanged before promoting")
    );
    assert!(
        at("Require the native code to be unchanged before promoting")
            < at("Mark the promotion as started")
    );
    assert!(at("Mark the promotion as started") < at("Promote to production"));
}
