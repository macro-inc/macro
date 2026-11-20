//! Preview deployment, as the last steps of the web `Build` job: the bundle that
//! job already built is the preview. Deploys to
//! `<branch>-<nanoid>-preview.macro.com`, built identically to dev.macro.com
//! (MODE=development, points at dev services).
//!
//! These steps must NOT block a merge, so each continues on error and the
//! `CI gate` doesn't see them fail. A `[no preview]` marker in the PR title opts
//! out without skipping CI.

use gh_workflow::expr::typed::{Bool, Expr, StepHandle, StepOutput, Str, github};
use gh_workflow::{Env, Run, Step, Use};

use crate::workflows::actions::AwsActionsConfigureAwsCredentials;
use crate::workflows::vars;

const PREVIEW_BUCKET: &str = "macro-preview-assets-dev";

const CREDENTIALS: StepHandle<()> = StepHandle::new("preview-credentials", ());
struct PreviewIdOutputs {
    /// The preview's id, read by the later steps' scripts.
    id: StepOutput<Str>,
}

const PREVIEW_ID: StepHandle<PreviewIdOutputs> = StepHandle::new(
    "preview-id",
    PreviewIdOutputs {
        id: StepOutput::new("preview-id", "id"),
    },
);
const BUCKET_CHECK: StepHandle<()> = StepHandle::new("preview-bucket", ());
const DEPLOY: StepHandle<()> = StepHandle::new("preview-deploy", ());

/// A fork has no credentials to deploy with, and a change that can't alter the
/// bundle has nothing new to show.
fn wanted() -> Expr<Bool> {
    super::PATH_CHECK
        .outputs
        .web_artifact_changed
        .read()
        .is_set()
        .and(
            !github()
                .event::<Str>("pull_request.title")
                .contains("[no preview]"),
        )
        .and(
            github()
                .event::<Str>("pull_request.head.repo.full_name")
                .eq(github().repository()),
        )
}

/// Env for the build step, so the bundle can serve as the preview.
pub fn build_env() -> [Env; 2] {
    [
        Env::new("VITE_SEGMENT_WRITE_KEY", vars::SEGMENT_WRITE_KEY_PRODUCTION),
        Env::new("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY),
    ]
}

/// Every deploy step with its gate, in order. A step that continues on error
/// still leaves `success()` true, so later steps check the steps they need.
pub fn steps() -> (Step<Use>, Vec<Step<Run>>) {
    let gate = |after_outcome: Expr<Str>| wanted().and(after_outcome.eq("success"));
    let credentials = configure_aws_credentials()
        .id(CREDENTIALS.id())
        .if_condition(wanted())
        .continue_on_error(true);
    let rest = vec![
        (get_or_create_preview_id(), gate(CREDENTIALS.outcome())),
        (
            validate_bucket_name().id(BUCKET_CHECK.id()),
            gate(PREVIEW_ID.outcome()),
        ),
        (deploy_to_s3().id(DEPLOY.id()), gate(BUCKET_CHECK.outcome())),
        (comment_on_pr(), gate(DEPLOY.outcome())),
    ]
    .into_iter()
    .map(|(step, condition)| {
        step.add_env(("PREVIEW_BUCKET", PREVIEW_BUCKET))
            .if_condition(condition)
            .continue_on_error(true)
    })
    .collect();
    (credentials, rest)
}

fn configure_aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("Configure AWS Credentials", "us-east-1")
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
}

fn get_or_create_preview_id() -> Step<Run> {
    Step::new("Get or create preview ID")
        .run(indoc::indoc! {r#"
            PREVIEW_ID=$(bun scripts/preview/get-or-create-id.ts \
              --pr "$PR_NUMBER" \
              --repo "$REPOSITORY" \
              --token "$GITHUB_TOKEN" \
              --branch "$BRANCH")
            echo "id=$PREVIEW_ID" >> "$GITHUB_OUTPUT"
            echo "Preview ID: $PREVIEW_ID"
        "#})
        .add_env(Env::new("BRANCH", github().head_ref()))
        .add_env(pr_number_env())
        .add_env(("REPOSITORY", github().repository()))
        .add_env(("GITHUB_TOKEN", vars::GITHUB_TOKEN))
        .id(PREVIEW_ID.id())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn validate_bucket_name() -> Step<Run> {
    Step::new("Validate bucket name").run(indoc::indoc! {r#"
        if [[ "$PREVIEW_BUCKET" != "macro-preview-assets-dev" ]]; then
          echo "ERROR: PREVIEW_BUCKET must be 'macro-preview-assets-dev'"
          exit 1
        fi
    "#})
}

fn deploy_to_s3() -> Step<Run> {
    Step::new("Deploy to S3")
        .run(indoc::indoc! {r#"
            bun scripts/preview/deploy.ts \
              --preview-id "$PREVIEW_ID" \
              --skip-build
        "#})
        .add_env(preview_id_env())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn comment_on_pr() -> Step<Run> {
    Step::new("Comment on PR")
        .run(indoc::indoc! {r#"
            bun scripts/preview/post-comment.ts \
              --pr "$PR_NUMBER" \
              --repo "$REPOSITORY" \
              --token "$GITHUB_TOKEN" \
              --preview-id "$PREVIEW_ID" \
              --sha "$SHA"
        "#})
        .add_env(pr_number_env())
        .add_env(("REPOSITORY", github().repository()))
        .add_env(("GITHUB_TOKEN", vars::GITHUB_TOKEN))
        .add_env(preview_id_env())
        .add_env(("SHA", github().sha()))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn pr_number_env() -> Env {
    Env::new("PR_NUMBER", github().event::<Str>("pull_request.number"))
}

/// The id [`get_or_create_preview_id`] wrote.
fn preview_id_env() -> Env {
    Env::new("PREVIEW_ID", PREVIEW_ID.outputs.id.read())
}
