//! Build an immutable runtime from main and request activation on one dev teammate.

use gh_workflow::expr::typed::{JobHandle, JobOutput, StepHandle, StepOutput, Str, github, input};
use gh_workflow::{
    Concurrency, Env, Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::actions::{ActionsCheckout, ActionsDownloadArtifact};
use crate::workflows::{runners, steps, vars};

const VALIDATE: JobHandle<()> = JobHandle::new("validate", ());

struct BuildOutputs {
    cli_sha256: JobOutput<Str>,
}
const BUILD: JobHandle<BuildOutputs> = JobHandle::new(
    "build",
    BuildOutputs {
        cli_sha256: JobOutput::new("build", "cli_sha256"),
    },
);

struct BuildCliOutputs {
    sha256: StepOutput<Str>,
}
const BUILD_CLI: StepHandle<BuildCliOutputs> = StepHandle::new(
    "build-cli",
    BuildCliOutputs {
        sha256: StepOutput::new("build-cli", "sha256"),
    },
);

const MANIFEST: &str = "agent-runtime-manifest";
const ARTIFACT_DIR: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/agent-runtime");
const CLI_ARTIFACT: &str = "agent-runtime-cli";
const CLI_PATH: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/agent-runtime-cli");

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
        .timeout_minutes(120u32)
        .add_output(
            BUILD.outputs.cli_sha256.name(),
            BUILD_CLI.outputs.sha256.read(),
        )
        .add_env(("ARTIFACT_DIR", ARTIFACT_DIR.as_str()))
        .add_env(("CLI_DIR", CLI_PATH.as_str()))
        .add_step(
            ActionsCheckout::new("Checkout the workflow's commit")
                .r#ref(github().sha())
                .persist_credentials(false)
                .step(),
        )
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::setup_dev_shell_named("agent-daemon"))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(
            Step::new("Build the rollout CLI")
                .run(include_str!("scripts/build_rollout_cli.sh"))
                .id(BUILD_CLI.id())
                .add_env(("CLI_BIN", "agent-runtime-update"))
                .add_env(("CLI_FEATURE", "runtime-update-cli"))
                .shell("bash"),
        )
        .add_step(steps::upload_artifact(CLI_ARTIFACT, CLI_PATH))
        .add_step(
            ActionsCheckout::new("Checkout the bundle commit")
                .r#ref(input::<Str>("source_sha"))
                .persist_credentials(false)
                .clean(false)
                .step(),
        )
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
        .add_env(("CLI_DIR", CLI_PATH.as_str()))
        .add_step(steps::download_artifacts(ARTIFACT_DIR, Some(MANIFEST)))
        .add_step(
            ActionsDownloadArtifact::new("Download Rollout CLI")
                .name(CLI_ARTIFACT)
                .path(CLI_PATH.as_str())
                .step(),
        )
        .add_step(bucket(inputs(
            Step::new("Request the runtime update and wait for verification")
                .run(include_str!("scripts/agent_runtime_rollout_run.sh"))
                .shell("bash")
                .add_env(("CLI_SHA256", BUILD.outputs.cli_sha256.read())),
        )))
}
