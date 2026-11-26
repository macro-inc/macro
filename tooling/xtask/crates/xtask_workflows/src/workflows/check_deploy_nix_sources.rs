//! `check deploy nix sources` — proves the sources the cloud-storage deploy
//! builds from hold the real code of every vendored `[patch.crates-io]` crate.
//!
//! The deploy's Nix derivations, the deps-only ones included, compile from a
//! stubbed copy of the workspace. A vendored patch left stubbed there breaks
//! every deploy while plain Cargo, which PR CI otherwise uses, still builds.
//! The check only builds the sources and compares them, so it takes minutes,
//! not a deploy build.
//! Generated into `check_deploy_nix_sources.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps, vars};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("vendor/**"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!(".github/workspace-dep-closures.json"),
    xtask_paths::repo_glob!("nix/**"),
    xtask_paths::repo_glob!("nix-support/**"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/workflows/check_deploy_nix_sources.yml"),
];

/// Build the workflow.
pub fn check_deploy_nix_sources() -> Workflow {
    Workflow::new("check deploy nix sources")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("check-deploy-nix-sources", check_deploy_nix_sources_job())
}

fn check_deploy_nix_sources_job() -> Job {
    Job::default()
        .timeout_minutes(30u32)
        .name("check deploy nix sources")
        .runs_on(runners::Runner::Small.with_cache_tag(vars::NIX_CHECKS_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            Step::new("Check vendored patches in the deploy sources").run(
                "nix build --no-link -L .#checks.x86_64-linux.pruned-deploy-src-vendored-patches",
            ),
        )
        .add_step(steps::teardown_nix())
}
