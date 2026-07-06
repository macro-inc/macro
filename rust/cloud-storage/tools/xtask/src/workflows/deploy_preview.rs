//! `Deploy Preview` — frontend feature-branch preview deployments.
//! Generated into `deploy_preview.yml` (replaces the hand-written
//! `deploy-preview.yml`; safe to rename since this is deliberately not a
//! required status check).
//!
//! Deploys a preview build to `<branch>-<nanoid>-preview.macro.com`, built
//! identically to dev.macro.com (MODE=development, points at dev services).
//!
//! NOTE: this workflow must NOT be added to required status checks — PRs
//! should be mergeable regardless of preview deploy status.

use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType,
    Run, Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

const PREVIEW_BUCKET: &str = "macro-preview-assets-dev";

/// Build the workflow.
pub fn deploy_preview() -> Workflow {
    Workflow::new("Deploy Preview")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_path("js/app/**"),
        ))
        .concurrency(
            Concurrency::new(Expression::new(
                "preview-${{ github.event.pull_request.number }}",
            ))
            .cancel_in_progress(true),
        )
        .add_env(("PREVIEW_BUCKET", PREVIEW_BUCKET))
        .add_job("deploy", deploy())
}

fn deploy() -> Job {
    Job::default()
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_step(checkout())
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(build())
        .add_step(configure_aws_credentials())
        .add_step(get_or_create_preview_id())
        .add_step(validate_bucket_name())
        .add_step(deploy_to_s3())
        .add_step(comment_on_pr())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

/// Build identical to the dev.macro.com deployment.
fn build() -> Step<Run> {
    Step::new("Build")
        .run("just build-dev")
        .working_directory("js/app")
        .add_env(Env::new("VITE_DD_WEB_APP_TOKEN", vars::DD_WEB_APP_TOKEN))
        .add_env(Env::new("VITE_DD_HASH", "${{ github.sha }}"))
        .add_env(Env::new(
            "VITE_SEGMENT_WRITE_KEY",
            vars::SEGMENT_WRITE_KEY_PRODUCTION,
        ))
        .add_env(Env::new("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
}

fn configure_aws_credentials() -> Step<Use> {
    Step::new("Configure AWS Credentials")
        .uses(
            "aws-actions",
            "configure-aws-credentials",
            "e7f100cf4c008499ea8adda475de1042d6975c7b",
        ) // v5
        .add_with(("aws-access-key-id", vars::AWS_ACCESS_KEY))
        .add_with(("aws-secret-access-key", vars::AWS_SECRET_ACCESS_KEY))
        .add_with(("aws-region", "us-east-1"))
}

fn get_or_create_preview_id() -> Step<Run> {
    Step::new("Get or create preview ID")
        .run(indoc::indoc! {r#"
            PREVIEW_ID=$(bun scripts/preview/get-or-create-id.ts \
              --pr ${{ github.event.pull_request.number }} \
              --repo ${{ github.repository }} \
              --token ${{ secrets.GITHUB_TOKEN }} \
              --branch "${{ github.head_ref }}")
            echo "id=$PREVIEW_ID" >> $GITHUB_OUTPUT
            echo "Preview ID: $PREVIEW_ID"
        "#})
        .id("preview-id")
        .working_directory("js/app")
}

fn validate_bucket_name() -> Step<Run> {
    Step::new("Validate bucket name").run(indoc::indoc! {r#"
        if [[ "${{ env.PREVIEW_BUCKET }}" != "macro-preview-assets-dev" ]]; then
          echo "ERROR: PREVIEW_BUCKET must be 'macro-preview-assets-dev'"
          exit 1
        fi
    "#})
}

fn deploy_to_s3() -> Step<Run> {
    Step::new("Deploy to S3")
        .run(indoc::indoc! {r#"
            bun scripts/preview/deploy.ts \
              --preview-id ${{ steps.preview-id.outputs.id }} \
              --skip-build
        "#})
        .working_directory("js/app")
}

fn comment_on_pr() -> Step<Run> {
    Step::new("Comment on PR")
        .run(indoc::indoc! {r#"
            bun scripts/preview/post-comment.ts \
              --pr ${{ github.event.pull_request.number }} \
              --repo ${{ github.repository }} \
              --token ${{ secrets.GITHUB_TOKEN }} \
              --preview-id ${{ steps.preview-id.outputs.id }} \
              --sha ${{ github.sha }}
        "#})
        .working_directory("js/app")
}
