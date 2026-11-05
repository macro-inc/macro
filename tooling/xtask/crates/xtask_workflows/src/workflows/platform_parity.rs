//! `platform parity` — fails a PR if the local and prod sizes of a Macro instance
//! render anything different but size (see docs/design/kubernetes-platform.md), or if
//! the AWS configuration stops validating. Neither needs credentials or applies
//! anything. Generated into `platform_parity.yml`.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn platform_parity() -> Workflow {
    Workflow::new("platform parity")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("infra/platform/**"))
                .add_path(xtask_paths::repo_glob!("nix/platform.nix"))
                .add_path(xtask_paths::repo_glob!("flake.lock"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/platform_parity.yml"
                )),
        ))
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
