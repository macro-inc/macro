//! `Observability AWS layer` — renders the observability cluster's OpenTofu
//! config (terranix) and runs `tofu validate` on it, offline, on a pull request
//! that changes it. `PR CI` calls it when [`PATHS`] change; it holds no
//! credentials and never plans or applies. Generated into
//! `observability_aws.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps};

const LAYER_DIR: &str = "infra/k8s/observability/aws";

/// The layer's flake and everything it renders from, plus this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("infra/k8s/observability/aws/**"),
    xtask_paths::repo_glob!(".github/workflows/observability_aws.yml"),
];

/// Build the workflow.
pub fn observability_aws() -> Workflow {
    Workflow::new("Observability AWS layer")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("validate", validate_job())
}

fn validate_job() -> Job {
    Job::default()
        .name("Render and validate")
        .runs_on(runners::Runner::Small.to_string())
        .timeout_minutes(15u32)
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            Step::new("Render and validate the OpenTofu configs")
                .run("nix flake check --print-build-logs")
                .shell("bash")
                .working_directory(LAYER_DIR),
        )
        .add_step(steps::teardown_nix())
}
