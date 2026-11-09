//! `check tauri lockfiles` — keeps both Tauri Cargo workspaces' lockfiles in step
//! with their manifests. The macOS release builds the desktop-cef workspace,
//! whose lockfile drifts silently when a shared `src-tauri` dependency changes;
//! this catches it on the PR instead of the next release.
//!
//! Plain Cargo answers that from the registry index, without a Nix store, so it
//! takes the same time on any runner. The offline Nix resolve also proves the
//! vendored sources build, which only a lockfile or Nix change can break, so it
//! runs only for those.
//! Generated into `check_tauri_lockfiles.yml`.

use gh_workflow::{Event, Expression, Job, Level, Permissions, Step, Use, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps, vars};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("apps/web/tauri/**"),
    xtask_paths::repo_glob!("crates/**/Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("nix/tauri-desktop.nix"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/workflows/check_tauri_lockfiles.yml"),
];

/// Build the workflow.
pub fn check_tauri_lockfiles() -> Workflow {
    Workflow::new("check tauri lockfiles")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("check-tauri-lockfiles", check_tauri_lockfiles_job())
        .add_job("check-tauri-vendoring", check_tauri_vendoring_job())
}

fn check_tauri_lockfiles_job() -> Job {
    Job::default()
        .name("check Tauri lockfiles")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            "vendoring_inputs",
            "${{ steps.filter.outputs.vendoring_inputs }}",
        )
        .add_step(steps::checkout(false, false))
        .add_step(vendoring_inputs_filter())
        .add_step(steps::setup_rust_light())
        .add_step(
            Step::new("Check lockfiles match their manifests").run(indoc::indoc! {r#"
                cargo update --workspace --locked --manifest-path apps/web/tauri/Cargo.toml
                cargo update --workspace --locked --manifest-path apps/web/tauri/desktop-cef/Cargo.toml
            "#}),
        )
}

fn vendoring_inputs_filter() -> Step<Use> {
    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("filter")
        .add_with((
            "filters",
            indoc::indoc! {r#"
                vendoring_inputs:
                  - 'apps/web/tauri/Cargo.lock'
                  - 'apps/web/tauri/desktop-cef/Cargo.lock'
                  - 'nix/tauri-desktop.nix'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/workflows/check_tauri_lockfiles.yml'
            "#},
        ))
}

fn check_tauri_vendoring_job() -> Job {
    Job::default()
        .name("check Tauri vendoring")
        .needs(vec!["check-tauri-lockfiles".to_string()])
        .cond(Expression::new(
            "needs.check-tauri-lockfiles.outputs.vendoring_inputs == 'true'",
        ))
        .runs_on(runners::Runner::Small.with_cache_tag(vars::NIX_CHECKS_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            Step::new("Resolve Tauri lockfiles offline")
                .run("nix build --no-link -L .#checks.x86_64-linux.tauri-cargo-lockfiles"),
        )
        .add_step(steps::teardown_nix())
}
