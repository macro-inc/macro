//! `Android Release Watch` — half-hourly cron closing the loop of the
//! `Android Native Check` gate (a job of [`super::web_app_check_main`]): that
//! check fails on a PR with Android native changes until the version code is
//! live on Google Play production, and nothing on GitHub's side notices when
//! Google releases it. This workflow looks at every open PR labeled
//! `android-update` (the label that started the
//! [`super::android_play_release`] run), asks Play whether the version code
//! committed at the PR head is live (built from the native code of the PR's
//! merge result, like the gate checks), and when it is, re-runs the PR's
//! failed `Android Native Check` job so the gate turns green on its own.
//! Re-running an existing job is how this stays within GitHub's rule that
//! events created with the workflow token never start workflows. The iOS
//! counterpart is [`super::ios_release_watch`].

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Run, Schedule, Step, Use, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps};

const HAS_PRS: &str = "steps.prs.outputs.count != '0'";

/// Build the workflow.
pub fn android_release_watch() -> Workflow {
    Workflow::new("Android Release Watch")
        .on(Event::default()
            .add_schedule(Schedule::new("*/30 * * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .contents(Level::Read)
                .id_token(Level::Write)
                .pull_requests(Level::Write),
        )
        .add_job("watch", watch_job())
}

fn watch_job() -> Job {
    Job::default()
        .name("Re-run the Android Native Check once the Play release is live")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(15u32)
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_step(find_prs())
        .add_step(steps::checkout(false, false).if_condition(gated()))
        .add_step(setup_bun())
        .add_step(play_auth())
        .add_step(rerun_live_checks())
}

fn gated() -> Expression {
    Expression::new(HAS_PRS)
}

fn find_prs() -> Step<Run> {
    Step::new("Find PRs waiting on a Play release")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            prs=$(gh pr list --repo "$GH_REPO" --label android-update --state open \
              --json number,headRefOid,potentialMergeCommit \
              --jq 'map({number, sha: .headRefOid, merge: .potentialMergeCommit.oid})' | jq -c .)
            count=$(jq 'length' <<<"$prs")
            echo "Open PRs labeled android-update: ${count}"
            echo "prs=${prs}" >> "$GITHUB_OUTPUT"
            echo "count=${count}" >> "$GITHUB_OUTPUT"
        "#})
        .id("prs")
        .shell("bash")
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

fn play_auth() -> Step<Use> {
    Step::new("Authenticate to Google Play")
        .uses(
            "google-github-actions",
            "auth",
            "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
        ) // v3
        .id("auth")
        .if_condition(gated())
        .add_with((
            "workload_identity_provider",
            "${{ vars.GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER }}",
        ))
        .add_with(("service_account", "${{ vars.GOOGLE_PLAY_SERVICE_ACCOUNT }}"))
        .add_with(("token_format", "access_token"))
        .add_with((
            "access_token_scopes",
            "https://www.googleapis.com/auth/androidpublisher",
        ))
        .add_with(("create_credentials_file", false))
        .add_with(("export_environment_variables", false))
}

fn rerun_live_checks() -> Step<Run> {
    Step::new("Re-run the check on PRs whose release is live")
        .run(concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/android_release_watch.sh")
        ))
        .shell("bash")
        .if_condition(gated())
        .add_env(("PRS", "${{ steps.prs.outputs.prs }}"))
        .add_env((
            "GOOGLE_PLAY_ACCESS_TOKEN",
            "${{ steps.auth.outputs.access_token }}",
        ))
}
