//! `platform parity` — fails a PR if the local and prod sizes of a Macro instance
//! render anything different but size (see docs/design/kubernetes-platform.md), or if
//! the AWS configuration stops validating. Neither needs credentials or applies
//! anything. Generated into `platform_parity.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("infra/platform/**"),
    xtask_paths::repo_glob!("nix/platform.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/workflows/platform_parity.yml"),
];

/// Build the workflow.
pub fn platform_parity() -> Workflow {
    Workflow::new("platform parity")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("parity", parity_job())
}

fn parity_job() -> Job {
    Job::default()
        .name("local and prod differ only in size")
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(Step::new("Compare renderings").run("nix build --no-link -L .#platform.parity"))
        .add_step(
            Step::new("Validate the AWS configuration")
                .run("nix build --no-link -L .#platform.awsCheck"),
        )
        .add_step(steps::teardown_nix())
}
