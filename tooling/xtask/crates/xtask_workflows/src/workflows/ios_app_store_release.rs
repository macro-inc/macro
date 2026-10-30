//! `iOS App Store Release` — add the `ios-update` label to a PR with breaking
//! native (Tauri) changes and this workflow builds the iOS app from the PR
//! head, uploads it to TestFlight, and submits it for App Review — the release
//! the `iOS Native Check` merge gate (a job of [`super::web_app_check_main`]) then waits on
//! ([`super::ios_release_watch`] re-runs the gate once Apple releases it).
//! The success comment tells the author to enable GitHub auto-merge on the
//! PR if they want it merged the moment Apple approves. The workflow does not
//! enable it itself: that would need a user token (a merge set up by the
//! Actions token does not trigger the push-to-main workflows, the dev
//! redeploy among them), and nobody's PAT belongs in a repo secret.
//!
//! The PR must already contain the version bump (`just ios-bump` in
//! `apps/web`, committed): the workflow verifies it and fails fast otherwise.
//! Bumping from CI would need a push with a PAT — a `GITHUB_TOKEN` push never
//! re-triggers the PR's required checks, wedging the PR — so the bump stays a
//! one-command local step and release retries stay label-driven (remove and
//! re-add `ios-update`).
//!
//! Runs like [`super::ios_preview`]: the Namespace macOS runner, with
//! cargo-tauri, bun, just, wasm-pack and the pinned toolchain (which carries
//! `aarch64-apple-ios`) from the Nix dev shell. `ios-release.sh` does the
//! Nix-vs-Xcode toolchain split itself through `ios-native-env.sh`, so one
//! `nix develop` invocation covers the whole build.
//!
//! Credentials come from Doppler (`ios-release/prd`, read with the
//! `IOS_RELEASE_DOPPLER_TOKEN` service token, like the DMG workflow's
//! `macos-release/prd`): the App Store Connect team API key (App Manager
//! role) and optionally an Apple Distribution certificate; without the
//! certificate xcodebuild uses cloud signing through the API key.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn ios_app_store_release() -> Workflow {
    Workflow::new("iOS App Store Release")
        .on(Event::default()
            .pull_request(PullRequest::default().add_type(PullRequestType::Labeled)))
        .concurrency(Concurrency::new(Expression::new(
            "ios-app-store-release-${{ github.event.pull_request.number }}",
        )))
        .add_job("release", release_job())
}

fn release_job() -> Job {
    Job::default()
        .name("iOS App Store Release")
        // Same-repo PRs only: the release needs the App Store Connect secrets,
        // which fork PRs don't receive anyway.
        .cond(Expression::new(
            "github.event.label.name == 'ios-update' && \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .runs_on(runners::Runner::MacOsArm.to_string())
        // Device build + upload + up to 30 minutes of App Store Connect
        // processing; the simulator preview alone measured ~11 minutes cold.
        .timeout_minutes(90u32)
        .permissions(
            Permissions::default()
                // The failure comment names the step that failed.
                .actions(Level::Read)
                .checks(Level::Read)
                .contents(Level::Read)
                .pull_requests(Level::Write)
                // `gh pr checks` also reads commit statuses (the CLA check).
                .statuses(Level::Read),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_env(("BASE_BRANCH", "${{ github.event.pull_request.base.ref }}"))
        .add_step(checkout_pr_head())
        .add_step(require_cli_tools())
        .add_step(preconditions())
        .add_step(steps::install_nix_macos())
        .add_step(verify_bump())
        .add_step(fetch_credentials())
        .add_step(require_unused_build())
        .add_step(configure_signing())
        .add_step(build_and_upload())
        .add_step(head_guard())
        .add_step(submit_for_review())
        .add_step(pr_comment())
}

/// `ios-update` means "release this and merge it when Apple approves", so the
/// PR must already be mergeable: not a draft, every other check on the head
/// commit green (pending ones are waited on). Fails before the long build.
fn preconditions() -> Step<Run> {
    steps::logged_run(
        "Require the PR to be ready to merge",
        concat!(
            include_str!("scripts/ios_native_tree.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/merge_result_native_check.sh"),
            include_str!("scripts/ios_release_preconditions.sh")
        ),
    )
    .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
    .add_env(("WAIT_MINUTES", "30"))
}

/// The pre-build steps run outside the Nix dev shell (it isn't installed
/// yet) and need `gh` + `jq`; the Namespace macOS image is not guaranteed to
/// ship them.
fn require_cli_tools() -> Step<Run> {
    steps::logged_run(
        "Ensure gh and jq are installed",
        indoc::indoc! {r#"
            set -euo pipefail
            for tool in gh jq; do
              if ! command -v "$tool" >/dev/null; then
                echo "${tool} missing on this runner; installing with Homebrew."
                brew install "$tool"
              fi
            done
            gh --version | head -1
            jq --version
        "#},
    )
}

/// Native code pushed while the build ran, on the PR or on `main`, would make
/// the upload stale; don't submit it (the drift workflow also withdraws after
/// the fact).
fn head_guard() -> Step<Run> {
    steps::logged_run(
        "Require the PR's native code to be unchanged since the build",
        concat!(
            include_str!("scripts/ios_native_tree.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/merge_result_native_check.sh"),
            include_str!("scripts/ios_release_head_guard.sh")
        ),
    )
}

fn checkout_pr_head() -> Step<Use> {
    Step::new("Checkout PR head")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("ref", "${{ github.event.pull_request.head.sha }}"))
        // Full history so the bump check can diff against the base branch.
        .add_with(("fetch-depth", 0))
        .add_with(("persist-credentials", false))
}

/// Run a command in `apps/web` inside the Nix dev shell, with its output
/// quotable by the failure comment (so not for the build: see `logged_run`).
fn in_dev_shell(name: &str, commands: &str) -> Step<Run> {
    steps::logged_run(name, dev_shell_script(commands))
}

fn dev_shell_script(commands: &str) -> String {
    format!("nix develop --command bash -euo pipefail -c '\n{commands}'")
}

fn verify_bump() -> Step<Run> {
    in_dev_shell(
        "Verify iOS release numbers were bumped",
        "  cd apps/web\n  bun scripts/ios-verify-native-bump.mjs\n",
    )
    .add_env((
        "BASE_REF",
        "origin/${{ github.event.pull_request.base.ref }}",
    ))
}

/// Writes the API key where altool/tauri/the scripts look for it and exports
/// `APPLE_API_KEY` / `APPLE_API_ISSUER` (plus the optional distribution
/// certificate path) through `GITHUB_ENV` for the steps below.
fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!("scripts/ios_app_store_connect_credentials.sh"))
        .shell("bash")
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
        .add_env(("IOS_DISTRIBUTION_CERTIFICATE", "1"))
}

/// Fail before the (long) build if App Store Connect already holds a build at
/// or above this PR's number that is not our own upload — another native PR
/// bumped from the same base, or a hand-made release whose bump was never
/// committed; the floor derived from the number would otherwise be wrong.
/// Our own earlier upload (same version, same native-tree stamp) sets
/// `uploaded=true`, and the build step is skipped: a retry goes straight to
/// submit, since Apple rejects re-uploading a build number anyway.
fn require_unused_build() -> Step<Run> {
    in_dev_shell(
        "Check the build number is unused in App Store Connect",
        "  cd apps/web\n  bun scripts/ios-app-store.mjs status --require-unused-build\n",
    )
    .id("build-check")
}

fn configure_signing() -> Step<Run> {
    Step::new("Configure signing identity")
        .run(include_str!("scripts/ios_release_signing.sh"))
        .shell("bash")
}

/// Build, validate, upload, and wait for App Store Connect processing +
/// export compliance — the PR already carries the bump, hence `--no-bump`.
/// The PostHog key is what `ios-build.sh` would otherwise pull from Doppler.
/// `wait-build` stamps the processed build with the native tree it was built
/// from (and the PR number), which the merge gate later verifies.
fn build_and_upload() -> Step<Run> {
    Step::new("Build and upload to App Store Connect")
        .run(dev_shell_script(
            "  bun install --frozen-lockfile\n  cd apps/web\n  just ios-release --no-bump\n",
        ))
        .shell("bash")
        .if_condition(Expression::new(
            "steps.build-check.outputs.uploaded != 'true'",
        ))
        .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
        .add_env(("IOS_RELEASE_PR", "${{ github.event.pull_request.number }}"))
}

/// `IOS_RELEASE_PR` lets `submit` recognise (and take over) this PR's own
/// earlier in-flight version from its build stamp.
fn submit_for_review() -> Step<Run> {
    in_dev_shell(
        "Submit for App Review",
        "  cd apps/web\n  bun scripts/ios-app-store.mjs submit\n",
    )
    .add_env(("IOS_RELEASE_PR", "${{ github.event.pull_request.number }}"))
}

fn pr_comment() -> Step<Use> {
    Step::new("Comment on the PR")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        // Not `always()`: a run the drift workflow cancelled must not post
        // "failed, re-add the label" next to drift's own comment.
        .if_condition(Expression::new("success() || failure()"))
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with((
            "script",
            indoc::indoc! {r#"
                const fs = require('fs');
                const path = require('path');
                const confPath = 'apps/web/tauri/src-tauri/tauri.ios.conf.json';
                const conf = fs.existsSync(confPath)
                  ? JSON.parse(fs.readFileSync(confPath, 'utf8'))
                  : { version: '?', bundle: { iOS: { bundleVersion: '?' } } };
                const version = conf.version;
                const build = conf.bundle.iOS.bundleVersion;
                const runUrl =
                  `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}` +
                  `/actions/runs/${context.runId}`;
                const success = '${{ job.status }}' === 'success';
                const SUCCESS_BODY = [
                  `📱 iOS ${version} (build ${build}) was uploaded to TestFlight and submitted for App Review.`,
                  '',
                  'When Apple approves it, the version releases to the App Store automatically,',
                  'the **iOS Release Watch** workflow re-runs the **iOS Native Check** on this PR',
                  'within half an hour of that, and the PR becomes mergeable. To merge it the',
                  'moment that happens, click **Enable auto-merge** on this PR now (squash).',
                  'After merge, the next prod deploy applies the iOS native build floor committed in `min-native-build.json`, prompting older installs to update.',
                  '',
                  `[Workflow run](${runUrl})`,
                ].join('\n');
                let body;
                if (success) {
                  body = SUCCESS_BODY;
                } else {
                  // Name the failed step and, when it is one that logs its
                  // output (steps::logged_run), quote the end of that output.
                  let failedStep = null;
                  try {
                    const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
                      owner: context.repo.owner,
                      repo: context.repo.repo,
                      run_id: context.runId,
                      attempt_number: Number(process.env.GITHUB_RUN_ATTEMPT),
                    });
                    const job = data.jobs.find((j) => j.name === 'iOS App Store Release');
                    failedStep = job?.steps.find((s) => s.conclusion === 'failure')?.name ?? null;
                  } catch (error) {
                    core.warning(`Could not list this job's steps: ${error.message}`);
                  }
                  const read = (file) => {
                    try {
                      return fs.readFileSync(path.join(process.env.RUNNER_TEMP, file), 'utf8');
                    } catch {
                      return '';
                    }
                  };
                  let tail = '';
                  if (failedStep && read('last-step.name').trim() === failedStep) {
                    const lines = read('last-step.log').replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n');
                    tail = lines.slice(-30).join('\n').slice(-3000);
                  }
                  body = [
                    `📱 iOS App Store release for ${version} (build ${build}) **failed**${failedStep ? ` at **${failedStep}**` : ''} — see the [workflow run](${runUrl}).`,
                    ...(tail ? ['', '```text', tail, '```'] : []),
                    '',
                    'Fix the problem, then remove and re-add the `ios-update` label to retry.',
                  ].join('\n');
                }
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  body,
                });
            "#},
        ))
}
