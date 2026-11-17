//! `Deploy Web App` — builds apps/web (via [`crate::workflows::build_web_app`])
//! and deploys it via the web-app pulumi stack; reusable (workflow_call) and
//! manually dispatchable. A caller that already ran the build in the same run
//! passes `prebuilt: true` to skip straight to the upload. Generated into
//! `deploy_web_app.yml` (replaces the hand-written `deploy-web-app.yml`;
//! dispatch identity is the workflow *name*, so the rename doesn't affect
//! anyone's dispatch habits).

use gh_workflow::{
    CallJob, Concurrency, Env, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall,
    WorkflowCallSecret, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::{build_web_app, runners, steps, vars};

/// Build the workflow.
pub fn deploy_web_app() -> Workflow {
    Workflow::new("Deploy Web App")
        .on(Event::default()
            .workflow_dispatch(
                WorkflowDispatch::default()
                    .add_input(
                        "environment",
                        WorkflowInput::choice(["dev", "prod"])
                            .description("The environment to build for")
                            .required(true),
                    )
                    .add_input(
                        "notify",
                        WorkflowInput::boolean()
                            .description(
                                "Whether to notify the Slack channel of the deployment completion",
                            )
                            .required(false),
                    ),
            )
            .workflow_call(
                WorkflowCall::default()
                    .add_input(
                        "environment",
                        WorkflowInput::string()
                            .description("The environment to build for. e.g. (dev, prod)")
                            .required(true),
                    )
                    .add_input("notify", WorkflowInput::boolean().required(false))
                    .add_input(
                        "prebuilt",
                        WorkflowInput::boolean()
                            .description("The caller already ran build_web_app.yml in this run")
                            .required(false)
                            .default(false),
                    )
                    .add_secret(
                        "AWS_ACCESS_KEY",
                        WorkflowCallSecret::default().required(true),
                    )
                    .add_secret(
                        "AWS_SECRET_ACCESS_KEY",
                        WorkflowCallSecret::default().required(true),
                    )
                    .add_secret(
                        "PULUMI_ACCESS_TOKEN",
                        WorkflowCallSecret::default().required(true),
                    )
                    .add_secret("DD_APP_KEY", WorkflowCallSecret::default().required(true))
                    .add_secret("DD_API_KEY", WorkflowCallSecret::default().required(true))
                    .add_secret(
                        "SEGMENT_WRITE_KEY",
                        WorkflowCallSecret::default().required(true),
                    )
                    .add_secret(
                        "POSTHOG_API_KEY",
                        WorkflowCallSecret::default().required(true),
                    ),
            ))
        .concurrency(
            // Serialize deploys per *environment*, with a literal prefix: for
            // workflow_call runs `github.workflow` expands to the caller's
            // name, so the hand-written `${{ github.workflow }}-web-app-…`
            // group split push-triggered and manually dispatched deploys into
            // different groups and let them race the same pulumi stack (same
            // fix as deploy-all-services). Never cancel in-progress — that
            // could leave the stack half-applied.
            Concurrency::new(Expression::new("deploy-web-app-${{ inputs.environment }}"))
                .cancel_in_progress(false),
        )
        .add_job("build", build())
        .add_job("deploy", deploy())
}

/// `inputs.prebuilt` is unset under workflow_dispatch, so dispatches build.
fn build() -> CallJob {
    CallJob::new("./.github/workflows/build_web_app.yml")
        .name("Build")
        .cond(Expression::new("${{ !inputs.prebuilt }}"))
        .add_with("environment", "${{ inputs.environment }}")
        .add_secret("SEGMENT_WRITE_KEY", "${{ secrets.SEGMENT_WRITE_KEY }}")
        .add_secret("POSTHOG_API_KEY", "${{ secrets.POSTHOG_API_KEY }}")
}

/// Runs after either this run's build or the caller's: a skipped build means
/// `prebuilt`, but the default `success()` would skip this job with it.
fn deploy() -> Job {
    Job::default()
        .name("Deploy")
        .needs(vec!["build".to_string()])
        .cond(Expression::new(
            "${{ !cancelled() && (needs.build.result == 'success' || needs.build.result == 'skipped') }}",
        ))
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_step(build_web_app::checkout())
        // It compiles nothing, so like the build it mounts only Nix and Bun.
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(download_dist(build_web_app::ARTIFACT))
        .add_step(install_infra_dependencies())
        .add_step(configure_aws_credentials())
        .add_step(pulumi_up(ENVIRONMENT))
        .add_step(upload_sourcemaps(ENVIRONMENT))
        .add_step(upload_production_build())
        .add_step(steps::teardown_nix())
}

/// The environment this workflow deploys, as its steps spell it.
const ENVIRONMENT: &str = "${{ inputs.environment }}";

/// `artifact` is a [`build_web_app::ARTIFACT`] name the same run uploaded.
pub fn download_dist(artifact: &str) -> Step<Use> {
    Step::new("Download dist")
        .uses("actions", "download-artifact", steps::DOWNLOAD_ARTIFACT_SHA)
        .add_with(("name", artifact))
        .add_with(("path", xtask_paths::runtime_path!("apps/web/dist").as_str()))
}

pub fn install_infra_dependencies() -> Step<Run> {
    Step::new("Install infra dependencies")
        .run("bun install")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

pub fn configure_aws_credentials() -> Step<Use> {
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

pub fn pulumi_up(environment: &str) -> Step<Use> {
    Step::new("Deploy with Pulumi")
        .uses(
            "pulumi",
            "actions",
            "8e5e406f4007fca908480587cb9893c07090f58d",
        ) // v6
        .add_with(("command", "up"))
        .add_with(("stack-name", format!("macro-inc/{environment}")))
        .add_with(("work-dir", "./infra/stacks/web-app"))
        .add_env(Env::new("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
        .add_env(Env::new("DD_APP_KEY", vars::DD_APP_KEY))
        .add_env(Env::new("DD_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DD_HOST", "https://api.us5.datadoghq.com/"))
}

pub fn upload_sourcemaps(environment: &str) -> Step<Run> {
    Step::new("Upload sourcemaps to Datadog")
        .run(format!("bun run ddupload:{environment}"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("DATADOG_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DATADOG_SITE", "us5.datadoghq.com"))
        .add_env(Env::new("DATADOG_API_HOST", "api.us5.datadoghq.com"))
}

fn upload_production_build() -> Step<Use> {
    Step::new("Upload production build")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .if_condition(Expression::new("${{ inputs.environment == 'prod' }}"))
        .add_with(("name", "web-app-build"))
        .add_with(("path", xtask_paths::runtime_path!("apps/web/dist").as_str()))
        .add_with(("overwrite", true))
}
