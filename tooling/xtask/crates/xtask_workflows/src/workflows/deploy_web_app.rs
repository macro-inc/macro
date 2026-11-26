//! `Deploy Web App` — builds apps/web (via [`crate::workflows::build_web_app`])
//! and deploys it via the web-app pulumi stack; reusable (workflow_call) and
//! manually dispatchable. A caller that already ran the build in the same run
//! passes `prebuilt: true` to skip straight to the upload. Generated into
//! `deploy_web_app.yml` (replaces the hand-written `deploy-web-app.yml`;
//! dispatch identity is the workflow *name*, so the rename doesn't affect
//! anyone's dispatch habits).

use std::fmt::Display;

use gh_workflow::expr::typed::{Bool, JobHandle, cancelled, input};
use gh_workflow::{
    CallJob, Concurrency, Env, Event, Job, Run, Step, Use, Workflow, WorkflowCall,
    WorkflowCallSecret, WorkflowDispatch, WorkflowInput, ZizmorRule,
};

use crate::workflows::actions::{
    ActionsDownloadArtifact, ActionsUploadArtifact, AwsActionsConfigureAwsCredentials,
    CallBuildWebApp, PulumiActions,
};
use crate::workflows::build_web_app::environment;
use crate::workflows::{build_web_app, runners, steps, vars};

/// The job that calls [`build_web_app`], unless the caller already built.
pub(crate) const BUILD: JobHandle<()> = JobHandle::new("build", ());

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
            Concurrency::new(format!("deploy-web-app-{}", environment())).cancel_in_progress(false),
        )
        .add_job(BUILD, build())
        .add_job("deploy", deploy())
}

/// `inputs.prebuilt` is unset under workflow_dispatch, so dispatches build.
fn build() -> CallJob {
    CallBuildWebApp::new(environment())
        .secret_segment_write_key(vars::SEGMENT_WRITE_KEY)
        .secret_posthog_api_key(vars::POSTHOG_API_KEY)
        .job()
        .name("Build")
        .cond(!input::<Bool>("prebuilt"))
}

/// Runs after either this run's build or the caller's: a skipped build means
/// `prebuilt`, but the default `success()` would skip this job with it.
fn deploy() -> Job {
    Job::default()
        .name("Deploy")
        .needs(vec![BUILD.to_string()])
        .cond(
            (!cancelled()).and(
                BUILD
                    .result()
                    .eq("success")
                    .or(BUILD.result().eq("skipped")),
            ),
        )
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_step(build_web_app::checkout().zizmor_ignore(
            ZizmorRule::Artipacked,
            "deploy scripts run from the checkout",
        ))
        // It compiles nothing, so like the build it mounts only Nix and Bun.
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(download_dist(&build_web_app::artifact(environment())))
        .add_step(install_infra_dependencies())
        .add_step(configure_aws_credentials())
        .add_step(pulumi_up(environment()))
        .add_step(
            upload_sourcemaps("\"$DEPLOY_ENVIRONMENT\"")
                .add_env(("DEPLOY_ENVIRONMENT", environment())),
        )
        .add_step(upload_production_build())
        .add_step(steps::teardown_nix())
}

/// `artifact` is a [`build_web_app::artifact`] name the same run uploaded.
pub fn download_dist(artifact: &str) -> Step<Use> {
    ActionsDownloadArtifact::new("Download dist")
        .name(artifact)
        .path(xtask_paths::runtime_path!("apps/web/dist").as_str())
        .step()
}

pub fn install_infra_dependencies() -> Step<Run> {
    Step::new("Install infra dependencies")
        .run("bun install")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

pub fn configure_aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("Configure AWS Credentials", "us-east-1")
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
}

/// `environment` is a name or the [`environment`] input.
pub fn pulumi_up(environment: impl Display) -> Step<Use> {
    PulumiActions::new("Deploy with Pulumi")
        .command("up")
        .stack_name(format!("macro-inc/{environment}"))
        .work_dir("./infra/stacks/web-app")
        .step()
        .add_env(Env::new("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
        .add_env(Env::new("DD_APP_KEY", vars::DD_APP_KEY))
        .add_env(Env::new("DD_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DD_HOST", "https://api.us5.datadoghq.com/"))
}

/// `environment` is shell text: a literal name, or a quoted reference to a
/// variable the caller adds to the step's env.
pub fn upload_sourcemaps(environment: impl Display) -> Step<Run> {
    Step::new("Upload sourcemaps to Datadog")
        .run(format!("bun run ddupload:{environment}"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("DATADOG_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DATADOG_SITE", "us5.datadoghq.com"))
        .add_env(Env::new("DATADOG_API_HOST", "api.us5.datadoghq.com"))
}

fn upload_production_build() -> Step<Use> {
    ActionsUploadArtifact::new(
        "Upload production build",
        xtask_paths::runtime_path!("apps/web/dist").as_str(),
    )
    .name("web-app-build")
    .overwrite(true)
    .step()
    .if_condition(environment().eq("prod"))
}
