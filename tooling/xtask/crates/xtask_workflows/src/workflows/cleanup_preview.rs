//! `Cleanup Preview` — removes a PR's preview files from S3 when the PR
//! closes (companion to the web `Build` job's preview steps). Generated into
//! `cleanup_preview.yml` (replaces the hand-written `cleanup-preview.yml`).

use gh_workflow::expr::typed::{github, steps};
use gh_workflow::{
    Env, Event, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step, Use, Workflow,
};

use crate::workflows::{runners, steps, vars};

const PREVIEW_BUCKET: &str = "macro-preview-assets-dev";

/// Build the workflow.
pub fn cleanup_preview() -> Workflow {
    Workflow::new("Cleanup Preview")
        .on(Event::default().pull_request(PullRequest::default().add_type(PullRequestType::Closed)))
        .add_env(("PREVIEW_BUCKET", PREVIEW_BUCKET))
        .add_job("cleanup", cleanup())
}

fn cleanup() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read),
        )
        .add_step(checkout())
        .add_step(setup_bun())
        .add_step(configure_aws_credentials())
        .add_step(get_preview_id())
        .add_step(cleanup_preview_files())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses("actions", "checkout", steps::CHECKOUT_SHA)
}

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun").uses("oven-sh", "setup-bun", steps::SETUP_BUN_SHA)
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

/// The branch name is attacker-controlled, so it reaches the script via env
/// (an env expansion can never become script text) instead of being inlined.
fn get_preview_id() -> Step<Run> {
    Step::new("Get preview ID from comments")
        .run(indoc::indoc! {r#"
            PREVIEW_ID=$(bun scripts/preview/get-or-create-id.ts \
              --pr ${{ github.event.pull_request.number }} \
              --repo ${{ github.repository }} \
              --token ${{ secrets.GITHUB_TOKEN }} \
              --branch "$BRANCH")
            echo "id=$PREVIEW_ID" >> "$GITHUB_OUTPUT"
            echo "Preview ID: $PREVIEW_ID"
        "#})
        .id("preview-id")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("BRANCH", github().head_ref()))
}

fn cleanup_preview_files() -> Step<Run> {
    Step::new("Cleanup preview")
        .run(indoc::indoc! {r#"
            bun scripts/preview/deploy.ts \
              --preview-id ${{ steps.preview-id.outputs.id }} \
              --cleanup
        "#})
        .if_condition(steps("preview-id").output("id").ne(""))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}
