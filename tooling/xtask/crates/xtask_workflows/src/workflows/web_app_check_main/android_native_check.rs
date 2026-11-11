//! `Android Native Check` — merge gate for PRs that change Android native
//! code, as a job of the web app PR checks so that `Web App Status Check`
//! (the required status check) covers it. The twin of
//! [`super::ios_native_check`]. The gate:
//!
//! 1. Requires an Android `versionCode` bump against the base branch when
//!    the Android native code changed (`scripts/android-version-check.mjs`,
//!    which shares its definition of "native code" with the release
//!    workflow through `android-native.mjs`: every tracked file under
//!    `apps/web/tauri` minus iOS/desktop-only paths, plus the client cache
//!    wasm version).
//! 2. When it changed, requires that version code to be a published
//!    production release (through review and rolled out) built from the
//!    native code of the PR's current merge result, and fails with
//!    instructions otherwise — add the `android-update` label to run
//!    [`super::super::android_play_release`].
//!
//! This job runs the PR's code, so it cannot sign in to Google Play: only
//! workflows that run `main`'s copy can. [`super::super::android_release_watch`]
//! asks Play instead, marks a PR whose release is live with the
//! `android-play/live` commit status (version code, native hash and PR
//! number in its description), and re-runs this job, which then finds the
//! status. The `skip-android-update` label bypasses the whole gate, bump
//! included, for native changes that don't break the native/web contract,
//! like `skip-ios-update`: the bump only feeds the Play release, which
//! re-checks it before building, and a PR that skips the gate never
//! releases. Because it never releases, such a PR must not raise the Android
//! native build floor in `min-native-build.json` either: after the next
//! production deploy, older installs would be told to update to a version
//! Play never published. Labels are read at run time (a re-run keeps the
//! original event payload). The job name must stay
//! stable: the release preconditions, the watcher and the label workflow
//! find it by name.

use gh_workflow::{Expression, Job, Level, Permissions, Run, Step, Use};

use crate::workflows::{runners, steps};

/// The job's id in the web app check workflow.
pub(super) const JOB_ID: &str = "android-native-check";

const NATIVE_CHANGED: &str = "steps.android-version.outputs.changed == 'true'";
const NOT_SKIPPED: &str = "steps.labels.outputs.skip != 'true'";
const SKIP_LABEL: &str = "steps.labels.outputs.skip == 'true'";

pub(super) fn job() -> Job {
    Job::default()
        .name("Android Native Check")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read)
                .statuses(Level::Read),
        )
        .add_step(super::checkout("Checkout PR merge commit", false))
        .add_step(setup_bun())
        .add_step(read_labels())
        .add_step(version_check())
        .add_step(floor_check())
        .add_step(require_live())
        .add_step(skip_notice())
}

fn gated() -> Expression {
    Expression::new(format!("{NATIVE_CHANGED} && {NOT_SKIPPED}"))
}

fn setup_bun() -> Step<Use> {
    steps::setup_bun_pinned()
}

/// Unless the label skips the gate, the version code must exceed the base
/// whenever the Android native code changed. Outputs `changed` and
/// `version_code`.
///
/// The base is the merge commit's first parent — the main the merge result
/// was actually built on — not the event payload's `base.sha`: GitHub can
/// compute the merge against a newer main than the payload names, and then
/// main's own native changes would be blamed on the PR. (`cat-file` because a
/// shallow checkout grafts the parents away for `rev-parse HEAD^1`.)
fn version_check() -> Step<Run> {
    Step::new("Require an Android version bump for native changes")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            base=$(git cat-file -p HEAD | sed -n 's/^parent //p' | head -1)
            echo "Comparing the merge result with its base ${base:0:10}"
            git fetch -q --depth=1 origin "$base"
            bun scripts/android-version-check.mjs "$base"
        "#})
        .id("android-version")
        .if_condition(Expression::new(NOT_SKIPPED))
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// With the skip label the PR never releases, so the Android floor must not
/// rise above the base's.
fn floor_check() -> Step<Run> {
    Step::new("Keep the Android native build floor without a release")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            base=$(git cat-file -p HEAD | sed -n 's/^parent //p' | head -1)
            git fetch -q --depth=1 origin "$base"
            bun scripts/android-version-check.mjs --skip-release "$base"
        "#})
        .if_condition(Expression::new(SKIP_LABEL))
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn read_labels() -> Step<Run> {
    Step::new("Read the PR's current labels")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            labels=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json labels --jq '[.labels[].name] | join(",")')
            echo "labels: ${labels:-<none>}"
            if [[ ",${labels}," == *",skip-android-update,"* ]]; then
              echo "skip=true" >> "$GITHUB_OUTPUT"
            else
              echo "skip=false" >> "$GITHUB_OUTPUT"
            fi
        "#})
        .id("labels")
        .shell("bash")
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
}

/// The gate proper: the committed version code must be live on production,
/// built from the Android native code of the PR's *current* merge result
/// (see the script).
fn require_live() -> Step<Run> {
    Step::new("Require the Play release to be live")
        .run(concat!(
            include_str!("../scripts/android_git_fetch.sh"),
            include_str!("../scripts/pr_merge_commit.sh"),
            include_str!("../scripts/android_play_statuses.sh"),
            include_str!("../scripts/android_native_check_live.sh")
        ))
        .if_condition(gated())
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_env((
            "VERSION_CODE",
            "${{ steps.android-version.outputs.version_code }}",
        ))
}

fn skip_notice() -> Step<Run> {
    Step::new("Skipped via label")
        .run(
            "echo \"The skip-android-update label says this PR's Android native changes don't \
             break the native/web contract — skipping the version bump and Play release gate.\"",
        )
        .if_condition(Expression::new(SKIP_LABEL))
}
