//! `Firecracker image rollout` — rolls a new guest image onto chosen running
//! Firecracker computers (`hosted_runtimes::domain::image_upgrade`), by hand
//! (`workflow_dispatch`). Development only: `environment` accepts only `dev`,
//! checked before anything else runs.
//!
//! 1. `validate`: the inputs. The image version is immutable
//!    (`<name>/<YYYY-MM-DD><letter>`, never a branch or `latest`), built from a
//!    full commit SHA on `main` at or after the agent trace wiring (#12046).
//! 2. `build`: build a portable `image-upgrade` from the workflow's commit
//!    and record its checksum. Build `.#macro-box-firecracker` at the image
//!    commit and publish the compressed files and digests to the cache bucket.
//!    Reuse the manifest for an already published version from that commit.
//! 3. `roll out`: on the in-VPC migrator runner, with the environment's
//!    database URL, verify the binary, presign the files, record the upgrade
//!    through `hosted_runtimes`' `image-upgrade`, then wait for it. The control
//!    plane's upgrade pass stages the image on the hosts, moves idle computers
//!    `batch_size` at a time, and rolls a computer back (pausing the upgrade)
//!    when macrod does not come back.

use gh_workflow::expr::typed::{JobHandle, JobOutput, StepHandle, StepOutput, Str, github, input};
use gh_workflow::{
    Concurrency, Env, Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::actions::{ActionsCheckout, ActionsDownloadArtifact};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

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

/// The artifact `build` hands `roll out`: the source commit and file digests.
const FILES_ARTIFACT: &str = "firecracker-image-files";
const FILES_PATH: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/firecracker-image");
const CLI_ARTIFACT: &str = "firecracker-image-cli";
const CLI_PATH: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/firecracker-image-cli");

/// Build the workflow.
pub fn firecracker_image_rollout() -> Workflow {
    Workflow::new("Firecracker image rollout")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default()
                .add_input(
                    "environment",
                    WorkflowInput::choice(["dev"])
                        .description("Where to roll out; dev only")
                        .required(true),
                )
                .add_input(
                    "image_version",
                    WorkflowInput::string()
                        .description("Immutable image version, e.g. macro-box/2026-11-24a")
                        .required(true),
                )
                .add_input(
                    "source_sha",
                    WorkflowInput::string()
                        .description("Full commit SHA on main the image is built from")
                        .required(true),
                )
                .add_input(
                    "computers",
                    WorkflowInput::string()
                        .description("Computer ids, comma-separated, in the order they move")
                        .required(true),
                )
                .add_input(
                    "batch_size",
                    WorkflowInput::choice(["1", "2", "3", "4", "5"])
                        .description("Computers under way at once")
                        .required(true)
                        .default("1"),
                )
                .add_input(
                    "idle_wait_minutes",
                    WorkflowInput::string()
                        .description("How long a computer may stay in use before it is skipped")
                        .required(true)
                        .default("30"),
                )
                .add_input(
                    "reconnect_timeout_minutes",
                    WorkflowInput::string()
                        .description("How long macrod has after a boot before a rollback")
                        .required(true)
                        .default("10"),
                ),
        ))
        .concurrency(
            Concurrency::new(format!(
                "firecracker-image-rollout-{}",
                input::<Str>("environment")
            ))
            .cancel_in_progress(false),
        )
        .add_job(VALIDATE, validate())
        .add_job(BUILD, build())
        .add_job("roll-out", roll_out())
}

/// The inputs as the scripts read them.
fn with_inputs(step: Step<Run>) -> Step<Run> {
    step.add_env(Env::new("ENVIRONMENT", input::<Str>("environment")))
        .add_env(Env::new("IMAGE_VERSION", input::<Str>("image_version")))
        .add_env(Env::new("SOURCE_SHA", input::<Str>("source_sha")))
        .add_env(Env::new("COMPUTERS", input::<Str>("computers")))
        .add_env(Env::new("BATCH_SIZE", input::<Str>("batch_size")))
        .add_env(Env::new(
            "IDLE_WAIT_MINUTES",
            input::<Str>("idle_wait_minutes"),
        ))
        .add_env(Env::new(
            "RECONNECT_TIMEOUT_MINUTES",
            input::<Str>("reconnect_timeout_minutes"),
        ))
}

/// The bucket and its credentials, for the steps that touch the image files.
fn with_bucket(step: Step<Run>) -> Step<Run> {
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
        .add_step(with_inputs(
            Step::new("Check the inputs")
                .run(include_str!(
                    "scripts/firecracker_image_rollout_validate.sh"
                ))
                .shell("bash"),
        ))
}

fn build() -> Job {
    Job::default()
        .name("Build and publish the image")
        .needs(vec![VALIDATE.to_string()])
        .runs_on(runners::Runner::Mid.with_cache_tag("firecracker-image"))
        .timeout_minutes(120u32)
        .add_output(
            BUILD.outputs.cli_sha256.name(),
            BUILD_CLI.outputs.sha256.read(),
        )
        .add_env(("FILES_DIR", FILES_PATH.as_str()))
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
                .run(include_str!("scripts/firecracker_image_rollout_cli.sh"))
                .id(BUILD_CLI.id())
                .shell("bash"),
        )
        .add_step(steps::upload_artifact(CLI_ARTIFACT, CLI_PATH))
        .add_step(
            ActionsCheckout::new("Checkout the image's commit")
                .r#ref(input::<Str>("source_sha"))
                .persist_credentials(false)
                .clean(false)
                .step(),
        )
        .add_step(with_bucket(with_inputs(
            Step::new("Build, hash and publish the image")
                .run(include_str!("scripts/firecracker_image_rollout_build.sh"))
                .shell("bash"),
        )))
        .add_step(steps::upload_artifact(FILES_ARTIFACT, FILES_PATH))
        .add_step(steps::teardown_nix())
}

fn roll_out() -> Job {
    Job::default()
        .name(format!("Roll out ({})", input::<Str>("environment")))
        .needs(vec![BUILD.to_string()])
        .runs_on(runners::DB_MIGRATOR)
        .timeout_minutes(360u32)
        .add_env(("FILES_DIR", FILES_PATH.as_str()))
        .add_env(("CLI_DIR", CLI_PATH.as_str()))
        .add_step(steps::download_artifacts(FILES_PATH, Some(FILES_ARTIFACT)))
        .add_step(
            ActionsDownloadArtifact::new("Download Rollout CLI")
                .name(CLI_ARTIFACT)
                .path(CLI_PATH.as_str())
                .step(),
        )
        .add_step(with_bucket(with_inputs(
            Step::new("Record the upgrade and wait for it")
                .run(include_str!("scripts/firecracker_image_rollout_run.sh"))
                .shell("bash")
                .add_env(("CLI_SHA256", BUILD.outputs.cli_sha256.read()))
                .add_env(Env::new(
                    "RUN_URL",
                    format!(
                        "{}/{}/actions/runs/{}",
                        github().server_url(),
                        github().repository(),
                        github().run_id()
                    ),
                )),
        )))
}
