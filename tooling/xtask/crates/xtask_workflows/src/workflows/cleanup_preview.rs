//! `Cleanup Preview` — removes a PR's preview files from S3 when the PR
//! closes (companion to the web `Build` job's preview steps). Generated into
//! `cleanup_preview.yml` (replaces the hand-written `cleanup-preview.yml`).

use gh_workflow::expr::typed::{StepHandle, StepOutput, Str, github};
use gh_workflow::{
    Env, Event, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step, Use, Workflow,
    ZizmorRule,
};

use crate::workflows::actions::{
    ActionsCheckout, AwsActionsConfigureAwsCredentials, OvenShSetupBun,
};
use crate::workflows::{runners, vars};

const PREVIEW_BUCKET: &str = "macro-preview-assets-dev";

pub(crate) struct PreviewIdOutputs {
    /// The PR's preview id, from its preview comment.
    pub id: StepOutput<Str>,
}

/// The step that reads the PR's preview id.
pub(crate) const PREVIEW_ID: StepHandle<PreviewIdOutputs> = StepHandle::new(
    "preview-id",
    PreviewIdOutputs {
        id: StepOutput::new("preview-id", "id"),
    },
);

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
    ActionsCheckout::new("Checkout Repo").step().zizmor_ignore(
        ZizmorRule::Artipacked,
        "preview scripts call the GitHub API",
    )
}

fn setup_bun() -> Step<Use> {
    OvenShSetupBun::new("Setup Bun").step()
}

fn configure_aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("Configure AWS Credentials", "us-east-1")
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
}

/// The branch name is attacker-controlled, so it reaches the script via env
/// (an env expansion can never become script text) instead of being inlined.
fn get_preview_id() -> Step<Run> {
    Step::new("Get preview ID from comments")
        .run(indoc::indoc! {r#"
            PREVIEW_ID=$(bun scripts/preview/get-or-create-id.ts \
              --pr "$PR_NUMBER" \
              --repo "$REPOSITORY" \
              --token "$GITHUB_TOKEN" \
              --branch "$BRANCH")
            echo "id=$PREVIEW_ID" >> "$GITHUB_OUTPUT"
            echo "Preview ID: $PREVIEW_ID"
        "#})
        .id(PREVIEW_ID.id())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new(
            "PR_NUMBER",
            github().event::<Str>("pull_request.number"),
        ))
        .add_env(Env::new("REPOSITORY", github().repository()))
        .add_env(Env::new("GITHUB_TOKEN", vars::GITHUB_TOKEN))
        .add_env(Env::new("BRANCH", github().head_ref()))
}

fn cleanup_preview_files() -> Step<Run> {
    Step::new("Cleanup preview")
        .run(indoc::indoc! {r#"
            bun scripts/preview/deploy.ts \
              --preview-id "$PREVIEW_ID" \
              --cleanup
        "#})
        .if_condition(PREVIEW_ID.outputs.id.read().ne(""))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("PREVIEW_ID", PREVIEW_ID.outputs.id.read()))
}
