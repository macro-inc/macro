//! Build an immutable runtime from main and request activation on one dev teammate.

use gh_workflow::expr::typed::{JobHandle, Str, input};
use gh_workflow::{
    Concurrency, Env, Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::actions::ActionsCheckout;
use crate::workflows::{runners, steps, vars};

const VALIDATE: JobHandle<()> = JobHandle::new("validate", ());
const BUILD: JobHandle<()> = JobHandle::new("build", ());
const MANIFEST: &str = "agent-runtime-manifest";
const ARTIFACT_DIR: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/agent-runtime");

pub fn agent_runtime_rollout() -> Workflow {
    Workflow::new("Agent runtime rollout")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default()
                .add_input(
                    "environment",
                    WorkflowInput::choice(["dev"])
                        .description("Development only")
                        .required(true),
                )
                .add_input(
                    "source_sha",
                    WorkflowInput::string()
                        .description("Full commit SHA on main")
                        .required(true),
                )
                .add_input(
                    "computer",
                    WorkflowInput::string()
                        .description("One agent teammate computer id")
                        .required(true),
                ),
        ))
        .concurrency(
            Concurrency::new(format!(
                "agent-runtime-rollout-{}",
                input::<Str>("computer")
            ))
            .cancel_in_progress(false),
        )
        .add_job(VALIDATE, validate())
        .add_job(BUILD, build())
        .add_job("roll-out", roll_out())
}

fn inputs(step: Step<Run>) -> Step<Run> {
    step.add_env(Env::new("ENVIRONMENT", input::<Str>("environment")))
        .add_env(Env::new("SOURCE_SHA", input::<Str>("source_sha")))
        .add_env(Env::new("COMPUTER", input::<Str>("computer")))
}

fn bucket(step: Step<Run>) -> Step<Run> {
    step.add_env(Env::new("NIX_CACHE_URL", vars::NIX_CACHE_URL))
        .add_env(Env::new("AWS_ACCESS_KEY_ID", vars::AWS_ACCESS_KEY))
        .add_env(Env::new(
            "AWS_SECRET_ACCESS_KEY",
            vars::AWS_SECRET_ACCESS_KEY,
        ))
}

fn validate() -> Job {
    Job::default()
        .name("Validate the inputs")
        .runs_on(runners::Runner::Small.to_string())
        .timeout_minutes(10u32)
        .add_step(steps::checkout(true, false))
        .add_step(inputs(
            Step::new("Validate dev, main and one computer id")
                .run(include_str!("scripts/agent_runtime_rollout_validate.sh"))
                .shell("bash"),
        ))
}

fn build() -> Job {
    Job::default()
        .name("Build and publish the runtime")
        .needs(vec![VALIDATE.to_string()])
        .runs_on(runners::Runner::Mid.with_cache_tag("firecracker-image"))
        .timeout_minutes(45u32)
        .add_env(("ARTIFACT_DIR", ARTIFACT_DIR.as_str()))
        .add_step(
            ActionsCheckout::new("Checkout the bundle commit")
                .r#ref(input::<Str>("source_sha"))
                .persist_credentials(false)
                .step(),
        )
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(bucket(inputs(
            Step::new("Build, hash and publish the runtime")
                .run(include_str!("scripts/agent_runtime_rollout_build.sh"))
                .shell("bash"),
        )))
        .add_step(steps::upload_artifact(MANIFEST, ARTIFACT_DIR))
        .add_step(steps::teardown_nix())
}

fn roll_out() -> Job {
    Job::default()
        .name("Activate on the selected dev teammate")
        .needs(vec![BUILD.to_string()])
        .runs_on(runners::DB_MIGRATOR)
        .timeout_minutes(120u32)
        .add_env(("ARTIFACT_DIR", ARTIFACT_DIR.as_str()))
        .add_env(("SQLX_OFFLINE", "true"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::download_artifacts(ARTIFACT_DIR, Some(MANIFEST)))
        .add_step(bucket(inputs(
            Step::new("Request the runtime update and wait for verification")
                .run(include_str!("scripts/agent_runtime_rollout_run.sh"))
                .shell("bash"),
        )))
}
