//! `iOS Native Check` — merge gate for PRs that change native iOS (Tauri)
//! code, as a job of the web app PR checks so that `Web App Status Check`
//! (the required status check) covers it without a ruleset change. Web
//! bundles ship over the air, but native changes only reach users through
//! the App Store, so a PR whose bundle depends on new native code must not
//! merge before that native build is actually downloadable. The gate:
//!
//! 1. Detects native changes: a path filter over `apps/web/tauri/**`,
//!    minus what never reaches the iOS binary (anything Android-only by
//!    name, the desktop updater manifest, editor config) — the same
//!    exclusions as the native tree hash in `scripts/ios_native_tree.sh` —
//!    or a bump of the client cache wasm package version
//!    (`crates/client/cache-wasm/Cargo.toml`): the app compiles the cache
//!    crates natively, and that version is the team's "this cache change
//!    must ship" signal, so the bump counts as native while other edits
//!    under `crates/client` don't. The filter needs dorny's `every`
//!    quantifier: with the default `some` a negated pattern matches every
//!    file outside it, i.e. everything.
//! 2. Verifies the PR bumped the iOS release numbers (`just ios-bump`):
//!    marketing version, build number, and `min-native-build.json`.
//! 3. Asks the App Store Connect API whether exactly that version + build is
//!    live on the App Store, built from the native tree this PR's current
//!    merge result has (fetched through the API, so native code that landed
//!    on main after the release also fails it, even on a re-run: the
//!    shipped build lacks it), and fails with instructions otherwise — add the
//!    `ios-update` label to run the `iOS App Store Release` workflow and
//!    wait for Apple's approval; `iOS Release Watch` re-runs this job once
//!    the release is live.
//!
//! The App Store Connect key comes from Doppler (`ios-release/prd` via the
//! `IOS_RELEASE_DOPPLER_TOKEN` secret), shared with the release workflow.
//!
//! The `skip-ios-update` label bypasses the gate for tauri changes that don't
//! break the native/web contract; the `Native Check Label` workflow
//! re-runs this job when that label is added or removed. The labels are read
//! through the API at run time, not from `github.event`: a re-run keeps the
//! payload of the event that started the run, so the event's label list is
//! stale by then. The job name must stay stable: the release workflow, the
//! watcher and that label workflow find the job by it.

use gh_workflow::{Expression, Job, Level, Permissions, Run, Step, Use};

use crate::workflows::{runners, vars};

/// The job's id in the web app check workflow.
pub(super) const JOB_ID: &str = "ios-native-check";
/// The job's display name (a check run name).
pub(super) const JOB_NAME: &str = "iOS Native Check";

/// Native iOS code changed: the path filter matched, or the cache wasm
/// version moved against the base branch.
const NATIVE_CHANGED: &str = "(steps.native-filter.outputs.ios_native == 'true' || steps.cache-wasm.outputs.bumped == 'true')";
/// The PR opted out of the gate via the `skip-ios-update` label (as read at
/// run time, see [`read_labels`]), and its negation. Spelled out rather than
/// `!SKIP_LABEL`: in GitHub expressions `!` binds tighter than `==`, so
/// `!a == 'true'` is `(!a) == 'true'`, false whatever `a` is.
const SKIP_LABEL: &str = "steps.labels.outputs.skip == 'true'";
const NOT_SKIPPED: &str = "steps.labels.outputs.skip != 'true'";

pub(super) fn job() -> Job {
    Job::default()
        .name(JOB_NAME)
        .runs_on(runners::Runner::TinyNoCache.to_string())
        // Reads only: the PR's labels and merge commit, and a base-branch fetch.
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read),
        )
        // Shallow: the path filter uses the API, and the bump check fetches
        // the base branch itself, only when it runs.
        .add_step(super::checkout("Checkout Repo", false))
        .add_step(paths_filter())
        .add_step(cache_wasm_version_bump())
        .add_step(read_labels())
        .add_step(setup_bun())
        .add_step(verify_bump())
        .add_step(fetch_credentials())
        .add_step(require_live_version())
        .add_step(skip_notice())
}

fn gated() -> Expression {
    Expression::new(format!("{NATIVE_CHANGED} && {NOT_SKIPPED}"))
}

fn paths_filter() -> Step<Use> {
    Step::new("Detect native iOS changes")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("native-filter")
        .add_with(("predicate-quantifier", "every"))
        .add_with((
            "filters",
            indoc::indoc! {"
                ios_native:
                  - 'apps/web/tauri/**'
                  - '!apps/web/tauri/**/android/**'
                  - '!apps/web/tauri/**/android_*'
                  - '!apps/web/tauri/**/android_*/**'
                  - '!apps/web/tauri/**/android.*'
                  - '!apps/web/tauri/**/*.android.*'
                  - '!apps/web/tauri/desktop-release.json'
                  - '!apps/web/tauri/.helix/**'
            "},
        ))
}

/// Did this PR move the client cache wasm package version against its base?
/// Compared on the merge ref, so a bump that already landed on main does not
/// count. Fetches the base branch (shallow) for the comparison.
fn cache_wasm_version_bump() -> Step<Run> {
    Step::new("Detect a client cache wasm version bump")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            manifest=crates/client/cache-wasm/Cargo.toml
            version() { git show "$1:$manifest" 2>/dev/null | sed -n 's/^version *= *"\([^"]*\)".*/\1/p' | head -1 | grep . || echo none; }
            # The merge commit's first parent is the main this merge result was
            # built on; a fresh fetch of main could be newer and misattribute
            # its bumps to the PR.
            base_sha=$(git cat-file -p HEAD | sed -n 's/^parent //p' | head -1)
            git fetch -q --depth=1 origin "$base_sha"
            echo "base_sha=${base_sha}" >> "$GITHUB_OUTPUT"
            base=$(version "$base_sha")
            head=$(version HEAD)
            echo "cache-wasm version: base ${base} (${base_sha:0:10}), merge result ${head}"
            if [[ "$base" != "$head" ]]; then
              echo "bumped=true" >> "$GITHUB_OUTPUT"
              echo "The client cache wasm version moved; the native app compiles that cache, so this counts as a native change."
            else
              echo "bumped=false" >> "$GITHUB_OUTPUT"
            fi
        "#})
        .id("cache-wasm")
        .shell("bash")
}

/// The PR's labels as they are now. `github.event.pull_request.labels` is
/// frozen at the event that started the run, so after the label workflow
/// re-runs this job it would still describe the old label set.
fn read_labels() -> Step<Run> {
    Step::new("Read the PR's current labels")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            labels=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json labels --jq '[.labels[].name] | join(",")')
            echo "labels: ${labels:-<none>}"
            if [[ ",${labels}," == *",skip-ios-update,"* ]]; then
              echo "skip=true" >> "$GITHUB_OUTPUT"
            else
              echo "skip=false" >> "$GITHUB_OUTPUT"
            fi
        "#})
        .id("labels")
        .if_condition(Expression::new(NATIVE_CHANGED))
        .shell("bash")
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
}

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun")
        .uses(
            "oven-sh",
            "setup-bun",
            "0c5077e51419868618aeaa5fe8019c62421857d6",
        ) // v2.2.0
        .if_condition(gated())
        .add_with(("bun-version", "1.3.13"))
}

fn verify_bump() -> Step<Run> {
    Step::new("Verify iOS release numbers were bumped")
        .run("bun scripts/ios-verify-native-bump.mjs")
        .if_condition(gated())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        // The base the merge result was built on (fetched by the cache-wasm step).
        .add_env(("BASE_REF", "${{ steps.cache-wasm.outputs.base_sha }}"))
}

/// Exports `APPLE_API_KEY` / `APPLE_API_ISSUER` via `GITHUB_ENV` and writes
/// the `.p8` where `ios-app-store.mjs` looks for it by default.
fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!(
            "../scripts/ios_app_store_connect_credentials.sh"
        ))
        .shell("bash")
        .if_condition(gated())
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
}

/// Compares the live build's stamp against the native tree of the PR's
/// *current* merge result — exactly what the floor derived from this build
/// claims ships. Asked through the API rather than taken from the checkout:
/// a re-run (the watcher's, the label workflow's, a human's) checks out the
/// merge commit as of the run's original event, which may predate native
/// code landing on main.
fn require_live_version() -> Step<Run> {
    Step::new("Require the App Store release to be live")
        .run(concat!(
            include_str!("../scripts/ios_native_tree.sh"),
            include_str!("../scripts/pr_merge_commit.sh"),
            include_str!("../scripts/ios_native_check_live.sh")
        ))
        .if_condition(gated())
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
}

fn skip_notice() -> Step<Run> {
    Step::new("Skipped via label")
        .run(
            "echo \"Native iOS changes detected, but the skip-ios-update label says they \
             don't break the native/web contract — skipping the App Store release gate.\"",
        )
        .if_condition(Expression::new(format!("{NATIVE_CHANGED} && {SKIP_LABEL}")))
}
